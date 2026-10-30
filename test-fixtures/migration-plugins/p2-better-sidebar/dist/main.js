// ../migrate-p2-better-sidebar/packages/domains/better-sidebar/src/contract.ts
var BUILT_IN_BETTER_SIDEBAR_TABS = Object.freeze([
  Object.freeze({
    id: "explorer",
    title: "Explorer",
    order: 10,
    summary: "Workspace files belong behind a governed workspace capability."
  }),
  Object.freeze({
    id: "changes",
    title: "Changes",
    order: 20,
    summary: "Repository changes remain owned by SciForge Git capabilities."
  }),
  Object.freeze({
    id: "tasks",
    title: "Tasks",
    order: 30,
    summary: "Task views use the selected SciForge session and runtime."
  }),
  Object.freeze({
    id: "sidechat",
    title: "Side chat",
    order: 40,
    summary: "Side chat is represented only as UI; it does not start an agent."
  })
]);
function createBetterSidebarRegistry(initial = BUILT_IN_BETTER_SIDEBAR_TABS) {
  const descriptors = /* @__PURE__ */ new Map();
  const register = (descriptor) => {
    const id = descriptor.id.trim();
    const title = descriptor.title.trim();
    if (!id || !title) throw new Error("Better Sidebar tab id and title are required.");
    if (!Number.isFinite(descriptor.order)) throw new Error(`Better Sidebar tab "${id}" needs a finite order.`);
    if (descriptors.has(id)) throw new Error(`Better Sidebar tab "${id}" is already registered.`);
    const stored = Object.freeze({ ...descriptor, id, title });
    descriptors.set(id, stored);
    let active2 = true;
    return () => {
      if (!active2) return;
      active2 = false;
      descriptors.delete(id);
    };
  };
  initial.forEach(register);
  return Object.freeze({
    list: () => Object.freeze([...descriptors.values()].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))),
    register
  });
}

// p2-better-sidebar.mjs
var active = false;
var disposeTabs = [];
async function activate() {
  active = true;
  const registry = createBetterSidebarRegistry();
  disposeTabs = [registry.register({ id: "fixture.extra", title: "Fixture", order: 50, summary: "Fixture tab" })];
  globalThis.__betterSidebarRegistry = registry;
}
async function deactivate() {
  for (const dispose2 of disposeTabs) dispose2();
  disposeTabs = [];
  active = false;
}
async function dispose() {
  await deactivate();
  delete globalThis.__betterSidebarRegistry;
}
function smoke() {
  if (!active) throw new Error("better-sidebar adapter is not active");
  const registry = globalThis.__betterSidebarRegistry;
  const tabs = registry.list();
  return { tabIds: tabs.map((tab) => tab.id), count: tabs.length };
}
function getRendererContributions() {
  return [{ id: "better-sidebar.workbench-right-panel", kind: "panel", title: "Better Sidebar" }, ...["explorer", "changes", "tasks", "sidechat"].map((id) => ({ id: `better-sidebar.tab.${id}`, kind: "tab", title: id }))];
}
export {
  activate,
  deactivate,
  dispose,
  getRendererContributions,
  smoke
};
