import { describe, expect, it } from 'vitest'
import { SteeringQueue } from '../src/loop/steering-queue.js'

describe('SteeringQueue', () => {
  it('keeps simultaneous turns isolated', () => {
    const queue = new SteeringQueue()
    queue.setTurn('turn_a')
    queue.enqueue('turn_a', 'keep file A unchanged')
    queue.setTurn('turn_b')
    queue.enqueue('turn_b', 'implement through file B')

    expect(queue.drain('turn_a')).toEqual(['keep file A unchanged'])
    expect(queue.drain('turn_b')).toEqual(['implement through file B'])
  })

  it('clears only the completed turn when a turn id is supplied', () => {
    const queue = new SteeringQueue()
    queue.enqueue('turn_a', 'A')
    queue.enqueue('turn_b', 'B')

    queue.clear('turn_b')

    expect(queue.peek('turn_a')).toEqual(['A'])
    expect(queue.peek('turn_b')).toEqual([])
  })

  it('retains the no-argument compatibility behavior', () => {
    const queue = new SteeringQueue()
    queue.setTurn('turn_a')
    queue.enqueue('turn_a', 'A')

    expect(queue.peek()).toEqual(['A'])
    expect(queue.drain()).toEqual(['A'])
    queue.enqueue('turn_a', 'B')
    queue.clear()
    expect(queue.peek()).toEqual([])
  })
})
