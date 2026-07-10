import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadMibigRecords } from './mibig-loader.js'

test('loads MIBiG 4 compound names and chemical activities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-mibig-'))
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'BGC0000001.json'), JSON.stringify({
    cluster: {
      mibig_accession: 'BGC0000001',
      biosyn_class: ['Polyketide'],
      organism_name: 'Verrucosispora maris AB-18-032',
      compounds: [
        {
          compound: 'abyssomicin C',
          chem_acts: [{ activity: 'antibacterial' }, { activity: 'cytotoxic' }]
        },
        {
          compound: 'atrop-abyssomicin C',
          chem_acts: [{ activity: 'antibacterial' }]
        }
      ]
    }
  }), 'utf8')

  const records = await loadMibigRecords(root, ['BGC0000001'])
  const record = records.get('BGC0000001')
  assert.ok(record)
  assert.equal(record.product, 'abyssomicin C; atrop-abyssomicin C')
  assert.equal(record.productClass, 'Polyketide')
  assert.equal(record.bioactivity, 'antibacterial; cytotoxic')
  assert.equal(record.organism, 'Verrucosispora maris AB-18-032')
})
