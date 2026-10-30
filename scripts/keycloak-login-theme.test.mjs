import assert from 'node:assert/strict'
import { stat, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const keycloakRoot = join(repositoryRoot, 'infra', 'keycloak')
const themeRoot = join(keycloakRoot, 'themes', 'sciforge', 'login')

async function read(relativePath) {
  return readFile(join(repositoryRoot, relativePath), 'utf8')
}

test('local Keycloak selects and mounts the SciForge login theme', async () => {
  const [realmText, compose, properties, styles, footer, english, chinese] = await Promise.all([
    read('infra/keycloak/realm-sciforge.json'),
    read('infra/keycloak/compose.yaml'),
    read('infra/keycloak/themes/sciforge/login/theme.properties'),
    read('infra/keycloak/themes/sciforge/login/resources/css/sciforge.css'),
    read('infra/keycloak/themes/sciforge/login/footer.ftl'),
    read('infra/keycloak/themes/sciforge/login/messages/messages_en.properties'),
    read('infra/keycloak/themes/sciforge/login/messages/messages_zh_CN.properties')
  ])
  const realm = JSON.parse(realmText)

  assert.match(realm.displayNameHtml, /sciforge-wordmark/u)
  assert.match(realm.displayNameHtml, /sciforge-wordmark__lead/u)
  assert.match(realm.displayNameHtml, /sciforge-wordmark__core/u)
  assert.equal(realm.loginTheme, 'sciforge')
  assert.match(compose, /- \.\/themes\/sciforge:\/opt\/keycloak\/themes\/sciforge:ro/u)
  assert.match(properties, /^parent=keycloak\.v2$/mu)
  assert.match(properties, /^styles=css\/styles\.css css\/sciforge\.css$/mu)
  assert.match(properties, /^stylesCommon=vendor\/patternfly-v5\/patternfly\.min\.css vendor\/patternfly-v5\/patternfly-addons\.css$/mu)
  assert.match(properties, /^darkMode=false$/mu)
  assert.match(properties, /^locales=en,zh-CN$/mu)
  assert.match(styles, /#kc-header-wrapper::before/u)
  assert.match(styles, /width: 280px;/u)
  assert.match(styles, /font-size: 4\.15rem !important/u)
  assert.match(styles, /content: "Research, made legible\."/u)
  assert.match(styles, /linear-gradient\(rgba\(121, 214, 205, 0\.035\)/u)
  assert.match(styles, /background-size: 96px 96px/u)
  assert.match(styles, /radial-gradient\(ellipse 42% 32% at 46% 34%/u)
  assert.match(styles, /\.sciforge-wordmark__core/u)
  assert.match(styles, /border-left: 2px solid rgba\(224, 167, 111, 0\.72\)/u)
  assert.match(styles, /clip-path: polygon\(0 0, 68% 0/u)
  assert.doesNotMatch(styles, /border-radius: 50%;/u)
  assert.doesNotMatch(styles, /content: "Research\. Refined\."/u)
  assert.doesNotMatch(styles, /mask-image: linear-gradient\(90deg/u)
  assert.doesNotMatch(styles, /SCIENCE \/ IDENTITY PLATFORM/u)
  assert.match(styles, /grid-template-areas: "header main"/u)
  assert.match(styles, /max-width: 1220px;/u)
  assert.match(styles, /minmax\(440px, 520px\)/u)
  assert.match(styles, /@media \(max-width: 980px\)/u)
  assert.match(styles, /prefers-reduced-motion/u)
  assert.doesNotMatch(styles, /https?:\/\//u)
  assert.match(footer, /sciforgeFooterTitle/u)
  assert.match(english, /sciforgeFooterNote=Protected by SciForge Identity/u)
  assert.match(chinese, /sciforgeFooterNote=由 SciForge Identity 提供保护/u)

  const mark = await stat(join(themeRoot, 'resources', 'img', 'sciforge-mark.png'))
  assert.ok(mark.isFile())
  assert.ok(mark.size > 10_000)
})
