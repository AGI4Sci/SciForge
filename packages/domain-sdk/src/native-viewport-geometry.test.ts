import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Window } from 'happy-dom'
import { measureNativeViewViewport } from './native-viewport-geometry.js'
test('only explicit active overlays obscure native views, without pixel hit tests', () => {
  const window = new Window({width:800,height:600})
  try {
    const document = window.document, slot = document.createElement('div'), overlay = document.createElement('div')
    document.body.append(slot, overlay)
    for (const element of [slot,overlay]) {
      element.getBoundingClientRect = () => new window.DOMRect(10,20,400,400)
      element.checkVisibility = () => true
    }
    document.elementFromPoint = () => { throw Error('Pixel hit testing must not be used') }
    const measure = () => measureNativeViewViewport(slot as unknown as HTMLElement,true)
    overlay.setAttribute('role','dialog')
    assert.equal(measure().visible,true)
    overlay.dataset.nativeViewOccluder='true'
    assert.equal(measure().visible,false)
    overlay.dataset.state='closed'
    assert.equal(measure().visible,true)
    overlay.dataset.state='open'; overlay.hidden=true
    assert.equal(measure().visible,true)
    overlay.hidden=false; overlay.append(slot)
    assert.equal(measure().visible,true)
    assert.equal(measureNativeViewViewport(slot as unknown as HTMLElement,false).visible,false)
    document.body.append(slot)
    overlay.getBoundingClientRect=()=>new window.DOMRect(3000,3000,100,100)
    slot.getBoundingClientRect=()=>new window.DOMRect(10,20,2000,2000)
    assert.deepEqual(measure(),{x:10,y:20,width:790,height:580,visible:true})
  } finally { window.close() }
})
