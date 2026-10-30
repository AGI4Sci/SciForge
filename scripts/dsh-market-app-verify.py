#!/usr/bin/env python3
"""Real-app market acceptance for every plugin in the published index.

Talks to the SAME IPC channels the renderer uses, in the running Electron app, so
every step goes through the real main-process market path: the index, the
artifacts, the signature check, the installer, the host policy and the capability
broker.

Phases (run in order against one isolated app instance):

  install   list → refuse an over-granting approval list → install each published
            plugin → progress → extensions list → call each capability with two
            different inputs → a boundary input must be refused → disable (the
            capability must stop working) → re-enable (it must work again)
  restart   call each capability again after a real app restart (proves the
            installation survived and stays usable) → uninstall → the capability
            must be gone

Usage:
  python3 scripts/dsh-market-app-verify.py --instance <dev-instance-id> --phase install
  python3 scripts/dsh-market-app-verify.py --instance <dev-instance-id> --phase restart

Exits non-zero on the first failed expectation, so it can gate a release check.
"""

import argparse
import json
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

BRIDGE = 'http://127.0.0.1:5174/invoke'
RENDERER_ORIGIN = 'http://127.0.0.1:5173'
CLIENT = 'dsh-market-verifier'
FIXTURES = json.loads((Path(__file__).resolve().parent / 'dsh-market-app-fixtures.json').read_text(encoding='utf-8'))


class Refused(Exception):
    """The call was refused — expected for calls that must fail."""


def invoke(channel, payload, instance):
    request = urllib.request.Request(
        f'{BRIDGE}?devInstanceId={instance}',
        data=json.dumps({'channel': channel, 'payload': payload}).encode(),
        headers={
            'Content-Type': 'application/json',
            'X-SciForge-Client': CLIENT,
            'X-SciForge-Dev-Instance': instance,
            'Origin': RENDERER_ORIGIN,
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=600) as response:
            envelope = json.loads(response.read())
    except urllib.error.HTTPError as error:
        raise Refused(f'{channel}: HTTP {error.code} {error.read()[:300]!r}') from error
    if not envelope.get('ok'):
        raise Refused(f'{channel}: {envelope.get("message")}')
    return envelope.get('payload')


def expand(fixture_input):
    """Expands the fixture shorthand for an oversized input."""
    if isinstance(fixture_input, dict) and '__repeat' in fixture_input:
        spec = fixture_input['__repeat']
        return {spec['key']: spec['char'] * spec['count']}
    return fixture_input


def call_capability(capability_id, payload, instance):
    """Returns the capability invocation result (the transport envelope is unwrapped).

    The transport request id must be a UUID: the preload generates one on every
    real call, and without it the transport fails before reaching the capability.
    """
    envelope = invoke('capability:invoke', {
        'transportRequestId': str(uuid.uuid4()),
        'request': {'actionId': capability_id, 'invocationId': f'inv-{uuid.uuid4()}', 'input': payload},
    }, instance)
    if not envelope.get('ok'):
        error = envelope.get('error') or {}
        raise Refused(f"{error.get('code')}: {error.get('message')}")
    return envelope['payload']


class Runner:
    def __init__(self, instance):
        self.instance = instance
        self.steps = []

    def step(self, name, detail):
        self.steps.append({'step': name, 'ok': True, 'detail': detail})
        print(f'  ✓ {name} — {json.dumps(detail, ensure_ascii=False)[:240]}', flush=True)

    @staticmethod
    def compute_tool(plugin):
        tools = plugin.get('tools') or []
        compute = [tool for tool in tools if tool.get('effect') == 'compute']
        chosen = compute or tools
        if not chosen:
            raise SystemExit(f'{plugin["name"]} declares no tool, so it cannot be exercised')
        return chosen[0]

    def install_phase(self):
        view = invoke('market:list', {}, self.instance)
        plugins = view['plugins']
        if not plugins:
            raise SystemExit(f'应用内市场没有可安装插件（error={view.get("error")}）')
        self.step('读取应用内市场索引', {
            'source': view.get('source', {}).get('location'),
            'installable': [f'{p["name"]}@{p["version"]}' for p in plugins],
            'notInstallable': len(view.get('notInstallable') or []),
            'capabilities': {p['name']: [c['id'] for c in p.get('capabilities', [])] for p in plugins},
        })

        all_refused = True
        for plugin in plugins:
            tool_names = [tool['name'] for tool in plugin['tools']]
            try:
                invoke('market:install', {
                    'packageName': plugin['name'],
                    'approvedToolNames': [*tool_names, 'extra.tool'],
                }, self.instance)
            except Refused:
                pass
            else:
                all_refused = False
                raise SystemExit(f'{plugin["name"]}: 应用接受了与声明不符的授权列表')
        self.step('拒绝与声明不符的授权列表', {'pluginsChecked': len(plugins), 'allRefused': all_refused})

        for plugin in plugins:
            if plugin.get('installed'):
                invoke('market:uninstall', {'packageName': plugin['name']}, self.instance)

        for plugin in plugins:
            tool_names = [tool['name'] for tool in plugin['tools']]
            result = invoke('market:install', {
                'packageName': plugin['name'],
                'approvedToolNames': tool_names,
            }, self.instance)
            self.step('应用内市场安装并启用', result)

            progress = invoke('market:progress', {'packageName': plugin['name']}, self.instance)
            self.step('安装进度为真实阶段', progress)

            listed = next((item for item in invoke('extensions:list', {}, self.instance)
                           if item['packageName'] == plugin['name']), None)
            if listed is None or listed.get('enabled') is not True:
                raise SystemExit(f'{plugin["name"]}: 扩展中心未显示为已启用')
            self.step('扩展中心显示为已启用', {
                'packageName': listed['packageName'], 'version': listed['version'], 'enabled': listed['enabled']})

            entry = next((p for p in invoke('market:list', {}, self.instance)['plugins']
                          if p['name'] == plugin['name']), None)
            if not entry or not entry['installed']:
                raise SystemExit(f'{plugin["name"]}: 市场列表没有反映已安装状态')
            self.step('市场列表反映已安装/已启用', {
                'installed': entry['installed'],
                'enabled': entry['enabled'],
                'registeredCapabilities': [c['id'] for c in entry.get('capabilities', []) if c.get('registered')],
            })

            self.exercise(plugin)

        print(json.dumps({'ok': True, 'phase': 'install', 'steps': self.steps}, ensure_ascii=False, indent=2), flush=True)

    def exercise(self, plugin):
        tool = self.compute_tool(plugin)
        fixture = FIXTURES.get(tool['id'])
        if fixture is None:
            raise SystemExit(f'缺少 {tool["id"]} 的调用夹具，无法验证真实使用')

        outputs = []
        for payload in fixture['ok']:
            output = call_capability(tool['id'], payload, self.instance)['output']
            if not output.get('ok'):
                raise SystemExit(f'{tool["id"]}: 调用失败 {json.dumps(output, ensure_ascii=False)[:200]}')
            outputs.append(output['result'])
        if json.dumps(outputs[0], sort_keys=True) == json.dumps(outputs[1], sort_keys=True):
            raise SystemExit(f'{tool["id"]}: 两组输入得到完全相同的输出，说明输出没有跟着输入走')
        for key, value in (fixture.get('expect') or {}).items():
            if outputs[0].get(key) != value:
                raise SystemExit(f'{tool["id"]}: {key} 期望 {value}，实际 {outputs[0].get(key)}')
        self.step('真实调用跟随输入变化', {
            'capabilityId': tool['id'],
            'inputs': [json.dumps(item, ensure_ascii=False) for item in fixture['ok']],
            'outputs': [json.dumps(item, ensure_ascii=False)[:200] for item in outputs],
        })

        output = call_capability(tool['id'], expand(fixture['boundary']), self.instance)['output']
        if output.get('ok') is not False:
            raise SystemExit(f'{tool["id"]}: 边界输入被接受：{json.dumps(output, ensure_ascii=False)[:200]}')
        code = (output.get('error') or {}).get('code')
        if code != fixture.get('boundaryCode'):
            raise SystemExit(f'{tool["id"]}: 边界拒绝码期望 {fixture.get("boundaryCode")}，实际 {code}')
        self.step('边界输入被明确拒绝', {'capabilityId': tool['id'], 'error': output['error']})

        disabled = invoke('market:set-enabled', {'packageName': plugin['name'], 'enabled': False}, self.instance)
        if disabled['enabled'] is not False:
            raise SystemExit(f'{plugin["name"]}: 禁用未生效')
        refusal = self.refusal_text(tool['id'], fixture['ok'][0], f'{plugin["name"]}: 禁用后能力仍可调用')
        self.step('禁用后不可调用', {'enabled': False, 'refusal': refusal})

        enabled = invoke('market:set-enabled', {'packageName': plugin['name'], 'enabled': True}, self.instance)
        if enabled['enabled'] is not True:
            raise SystemExit(f'{plugin["name"]}: 重新启用未生效')
        again = call_capability(tool['id'], fixture['ok'][0], self.instance)['output']
        if not again.get('ok'):
            raise SystemExit(f'{plugin["name"]}: 重新启用后调用失败 {json.dumps(again, ensure_ascii=False)[:200]}')
        self.step('重新启用后恢复可用', {
            'enabled': True,
            'sameResultAsFirstRun': json.dumps(again['result'], sort_keys=True) == json.dumps(outputs[0], sort_keys=True),
        })

    def refusal_text(self, capability_id, payload, message):
        """Calls a capability that must now fail; returns how it failed."""
        try:
            result = call_capability(capability_id, payload, self.instance)
        except Refused as error:
            return str(error)
        if result['output'].get('ok') is not False:
            raise SystemExit(message)
        return json.dumps(result['output'], ensure_ascii=False)[:200]

    def restart_phase(self):
        plugins = invoke('market:list', {}, self.instance)['plugins']
        if not plugins:
            raise SystemExit('重启后市场里没有插件')
        for plugin in plugins:
            if not plugin.get('installed'):
                raise SystemExit(f'{plugin["name"]}: 重启后不再是已安装状态')
            listed = next((item for item in invoke('extensions:list', {}, self.instance)
                           if item['packageName'] == plugin['name']), None)
            if listed is None or listed.get('enabled') is not True:
                raise SystemExit(f'{plugin["name"]}: 重启后未恢复启用')
            tool = self.compute_tool(plugin)
            fixture = FIXTURES[tool['id']]
            output = call_capability(tool['id'], fixture['ok'][0], self.instance)['output']
            if not output.get('ok'):
                raise SystemExit(f'{plugin["name"]}: 重启后调用失败 {json.dumps(output, ensure_ascii=False)[:200]}')
            self.step('重启后仍已安装且可完成真实任务', {
                'packageName': plugin['name'], 'installed': True, 'enabled': True,
                'capabilityId': tool['id'], 'result': json.dumps(output['result'], ensure_ascii=False)[:200],
            })

        for plugin in plugins:
            tool = self.compute_tool(plugin)
            fixture = FIXTURES[tool['id']]
            invoke('market:uninstall', {'packageName': plugin['name']}, self.instance)
            still = next((p for p in invoke('market:list', {}, self.instance)['plugins']
                          if p['name'] == plugin['name']), None)
            if still and still.get('installed'):
                raise SystemExit(f'{plugin["name"]}: 卸载后仍显示已安装')
            refusal = self.refusal_text(tool['id'], fixture['ok'][0], f'{plugin["name"]}: 卸载后能力仍可调用')
            self.step('卸载后不再加载且不可调用', {
                'packageName': plugin['name'], 'installed': False, 'refusal': refusal})

        print(json.dumps({'ok': True, 'phase': 'restart', 'steps': self.steps}, ensure_ascii=False, indent=2), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--instance', required=True)
    parser.add_argument('--phase', choices=['install', 'restart'], default='install')
    options = parser.parse_args()

    runner = Runner(options.instance)
    if options.phase == 'install':
        runner.install_phase()
    else:
        runner.restart_phase()


if __name__ == '__main__':
    try:
        main()
    except SystemExit as error:
        if error.code not in (None, 0):
            print(json.dumps({'ok': False, 'error': str(error.code)}, ensure_ascii=False, indent=2))
        raise
    except Exception as error:  # noqa: BLE001 - reporting the failure is the point
        print(json.dumps({'ok': False, 'error': f'{type(error).__name__}: {error}'}, ensure_ascii=False, indent=2))
        sys.exit(1)