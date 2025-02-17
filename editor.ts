// This file implements a super simple text editor using textarea on top of the
// CRDT implementation.

import { CRDTDocument } from "./crdt.js"

type DiffResult = {pos: number, del: number, ins: string}

// This is a very simple diff function. Notably it doesn't take into account
// the user's cursor position - so as you type "aaaaa", we can't tell which
// "a" you've just inserted each time.
const calcDiff = (oldval: string, newval: string): DiffResult => {
  // Strings are immutable and have reference equality. I think this test is O(1), so its worth doing.
  if (oldval === newval) return {pos: 0, del: 0, ins: ''}

  let oldChars = [...oldval]
  let newChars = [...newval]

  var commonStart = 0;
  while (oldChars[commonStart] === newChars[commonStart]) {
    commonStart++;
  }

  var commonEnd = 0;
  while (oldChars[oldChars.length - 1 - commonEnd] === newChars[newChars.length - 1 - commonEnd] &&
      commonEnd + commonStart < oldChars.length && commonEnd + commonStart < newChars.length) {
    commonEnd++;
  }

  const del = (oldChars.length !== commonStart + commonEnd)
    ? oldChars.length - commonStart - commonEnd
    : 0
  const ins = (newChars.length !== commonStart + commonEnd)
    ? newChars.slice(commonStart, newChars.length - commonEnd).join('')
    : ''

  return {
    pos: commonStart, del, ins
  }
}

const elemById = (name: string): HTMLElement => {
  const elem = document.getElementById(name)
  if (elem == null) throw Error('Missing element ' + name)
  return elem
}

const attachEditor = (agentName: string, elemName: string) => {
  const elem = elemById(elemName) as HTMLTextAreaElement

  const doc = new CRDTDocument(agentName)
  let lastValue = doc.getString()
  elem.value = lastValue

  ;['textInput', 'keydown', 'keyup', 'select', 'cut', 'paste', 'input'].forEach(eventName => {
    elem.addEventListener(eventName, e => {
      setTimeout(() => {
        // assert(vEq(doc.getLocalVersion(), last_version))
        let newValue = elem.value.replace(/\r\n/g, '\n')
        if (newValue !== lastValue) {
          let { pos, del, ins } = calcDiff(lastValue, newValue)

          if (del > 0) doc.del(pos, del)
          if (ins !== '') doc.ins(pos, ins)
          // console.log('server version', Array.from(server_version))

          if (doc.getString() != newValue) throw Error('Diff invalid - document does not match')

          // last_version = doc.getLocalVersion()
          lastValue = newValue

          console.log(doc.inner)
        }
      }, 0)
    }, false)
  })

  return {
    doc,
    reset() {
      doc.reset()
      elem.value = lastValue = doc.getString()
    },
    mergeFrom(other: CRDTDocument) {
      doc.mergeFrom(other)
      elem.value = lastValue = doc.getString()
    }
  }
}

window.onload = () => {
  const a = attachEditor('a', 'text1')
  const b = attachEditor('b', 'text2')

  elemById('reset').onclick = () => {
    console.log('reset')
    a.reset()
    b.reset()
  }

  elemById('pushLeft').onclick = () => {
    a.mergeFrom(b.doc)
  }
  elemById('pushRight').onclick = () => {
    b.mergeFrom(a.doc)
  }

  console.log('OK!')
}
