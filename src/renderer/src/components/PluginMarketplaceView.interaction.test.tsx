// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import enCommon from '../locales/en/common.json'
import { PluginMarketplaceView } from './PluginMarketplaceView'

vi.mock('../store/chat-store', () => ({ useChatStore: (selector: (state: {workspaceRoot: string}) => unknown) => selector({workspaceRoot: '/workspace'}) }))
let container: HTMLDivElement
let root: Root
const saveSkillFile = vi.fn(async () => ({ok:true,path:'/workspace/skills/code-review/SKILL.md'}))
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  saveSkillFile.mockClear()
  vi.stubGlobal('sciforge', {
    extensions: {list: async () => []},
    listSkills: async () => ({ok:true,skills:Array.from({length:8},(_,index)=>({id:`personal-${index}`,name:`Personal ${index}`,description:'A long skill description that belongs in the detail view.',root:`/workspace/skills/personal-${index}`,entryPath:`/workspace/skills/personal-${index}/SKILL.md`,scope:'global',legacy:false})),validationErrors:[]}), saveSkillFile
  })
  container=document.createElement('div');document.body.append(container);root=createRoot(container)
  const i18n=i18next.createInstance()
  await i18n.init({lng:'en',defaultNS:'common',resources:{en:{common:enCommon}}})
  await act(async () => root.render(createElement(I18nextProvider,{i18n},createElement(PluginMarketplaceView))))
  await act(async () => container.querySelector<HTMLButtonElement>('#extension-center-skills-tab')!.click())
})
afterEach(async () => {await act(async () => root.unmount());container.remove();vi.unstubAllGlobals()})
it('opens a skill detail view without installing and returns to the catalog', async () => {
  const target=container.querySelector<HTMLButtonElement>('[aria-label="Show details for Code Review"]')
  expect(target).not.toBeNull()
  await act(async () => target!.click())
  expect(container.querySelector('[data-skill-details]')).not.toBeNull()
  expect(container.textContent).toContain('Use this skill when reviewing a code change.')
  expect(saveSkillFile).not.toHaveBeenCalled()
  const back=Array.from(container.querySelectorAll('button')).find(button=>button.textContent==='Back to skills')!
  await act(async () => back.click())
  expect(container.querySelector('[data-skill-details]')).toBeNull()
})
it('keeps the add action separate from opening details', async () => {
  const add=container.querySelector<HTMLButtonElement>('[aria-label="Add Code Review"]')
  expect(add).not.toBeNull()
  await act(async () => add!.click())
  expect(saveSkillFile).toHaveBeenCalledTimes(1)
  expect(container.querySelector('[data-skill-details]')).toBeNull()
})

it('previews six installed skills and lets the user expand and collapse the full list', async () => {
  expect(container.querySelector('[aria-label="Show details for Personal 5"]')).not.toBeNull()
  expect(container.querySelector('[aria-label="Show details for Personal 6"]')).toBeNull()
  const button=(text:string)=>Array.from(container.querySelectorAll('button')).find(item=>item.textContent===text)!
  await act(async()=>button('Show all (8)').click())
  expect(container.querySelector('[aria-label="Show details for Personal 7"]')).not.toBeNull()
  await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Show details for Personal 7"]')!.click())
  await act(async()=>button('Back to skills').click())
  expect(container.querySelector('[aria-label="Show details for Personal 7"]')).not.toBeNull()
  await act(async()=>button('Show less').click())
  expect(container.querySelector('[aria-label="Show details for Personal 6"]')).toBeNull()
})

it('searches skills outside the initial six-item preview', async () => {
  expect(container.querySelector('[aria-label="Show details for Personal 7"]')).toBeNull()
  await act(async () => {
    const search=container.querySelector<HTMLInputElement>('input')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(search,'Personal 7')
    search.dispatchEvent(new Event('input',{bubbles:true}))
  })
  expect(container.querySelector('[aria-label="Show details for Personal 7"]')).not.toBeNull()
  expect(container.querySelector('[aria-label="Show details for Personal 0"]')).toBeNull()
})
