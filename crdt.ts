
type Id = [agent: string, seq: number]

type Item = {
  content: string, // 1 character

  id: Id,
  originLeft: Id | null,
  originRight: Id | null,

  deleted: boolean,
}

type Version = Record<string, number>
// type Version = {[key: string]: number}

type Doc = {
  content: Item[],
  version: Version,
}

function createDoc(): Doc {
  return {
    content: [],
    version: {}
  }
}

function getContent(doc: Doc): string {
  // return doc.content
  //   .filter(item => !item.deleted)
  //   .map(item => item.content)
  //   .join('')

  let content = ''
  for (const item of doc.content) {
    if (!item.deleted) {
      content += item.content
    }
  }
  return content
}

// Find the index of the item at the specified content position in the document.
const findItemAtPos = (doc: Doc, pos: number, stickEnd: boolean = false): number => {
  let i = 0
  // console.log('pos', pos, doc.length, doc.content.length)
  for (; i < doc.content.length; i++) {
    const item = doc.content[i]
    if (stickEnd && pos === 0) return i
    else if (item.deleted) continue
    else if (pos === 0) return i

    pos--
  }

  if (pos === 0) return i
  else throw Error('past end of the document')
}

function localInsertOne(doc: Doc, agent: string, pos: number, text: string) {
  // let seq = 0
  // if (doc.version[agent] != null) {
  //   seq = doc.version[agent] + 1
  // }

  const idx = findItemAtPos(doc, pos, true)

  const seq = (doc.version[agent] ?? -1) + 1
  integrate(doc, {
    content: text,
    id: [agent, seq],
    deleted: false,
    originLeft: doc.content[idx - 1]?.id ?? null,
    originRight: doc.content[idx]?.id ?? null,
  })
}

function localInsert(doc: Doc, agent: string, pos: number, text: string) {
  const content = [...text]
  for (const c of content) {
    localInsertOne(doc, agent, pos, c)
    pos++
  }
}

function remoteInsert(doc: Doc, item: Item) {
  integrate(doc, item)
}

function localDelete(doc: Doc, pos: number, delLen: number) {
  while (delLen > 0) {
    const idx = findItemAtPos(doc, pos, false)
    doc.content[idx].deleted = true
    delLen--
  }
}

const idEq = (a: Id | null, b: Id | null): boolean => (
  a == b || (a != null && b != null && a[0] === b[0] && a[1] === b[1])
)

function findItemIdxAtId(doc: Doc, id: Id | null): number | null {
  if (id == null) return null

  // return doc.content.findIndex(c => idEq(c.id, id))
  for (let i = 0; i < doc.content.length; i++) {
    if (idEq(doc.content[i].id, id)) return i
  }
  throw Error("Can't find item")
}

function integrate(doc: Doc, newItem: Item) {
  const [agent, seq] = newItem.id
  const lastSeen = doc.version[agent] ?? -1
  if (seq !== lastSeen + 1) throw Error('Operations out of order')

  // Mark the item in the document version.
  doc.version[agent] = seq

  // If originLeft is null, that means it was inserted at the start of the document.
  // We'll pretend there was some item at position -1 which we were inserted to the
  // right of.
  let left = findItemIdxAtId(doc, newItem.originLeft) ?? -1
  let destIdx = left + 1
  let right = newItem.originRight == null ? doc.content.length : findItemIdxAtId(doc, newItem.originRight)!
  let scanning = false

  // This loop scans forward from destIdx until it finds the right place to insert into
  // the list.
  for (let i = destIdx; ; i++) {
    if (!scanning) destIdx = i
    // If we reach the end of the document, just insert.
    if (i === doc.content.length) break
    if (i === right) break // No ambiguity / concurrency. Insert here.

    let other = doc.content[i]

    let oleft = findItemIdxAtId(doc, other.originLeft) ?? -1
    let oright = other.originRight == null ? doc.content.length : findItemIdxAtId(doc, other.originRight)!

    // The logic below summarizes to:
    if (oleft < left || (oleft === left && oright === right && newItem.id[0] < other.id[0])) break
    if (oleft === left) scanning = oright < right

    // This is the same code as the above 2 lines, but written out the long way:
    // if (oleft < left) {
    //   // Top row. Insert, insert, arbitrary (insert)
    //   break
    // } else if (oleft === left) {
    //   // Middle row.
    //   if (oright < right) {
    //     // This is tricky. We're looking at an item we *might* insert after - but we can't tell yet!
    //     scanning = true
    //     continue
    //   } else if (oright === right) {
    //     // Raw conflict. Order based on user agents.
    //     if (newItem.id[0] < other.id[0]) break
    //     else {
    //       scanning = false
    //       continue
    //     }
    //   } else { // oright > right
    //     scanning = false
    //     continue
    //   }
    // } else { // oleft > left
    //   // Bottom row. Arbitrary (skip), skip, skip
    //   continue
    // }
  }

  // We've found the position. Insert here.
  doc.content.splice(destIdx, 0, newItem)
  // if (!newItem.deleted) doc.length += 1
}

function isInVersion(id: Id | null, version: Version): boolean {
  if (id == null) return true
  const [agent, seq] = id
  const highestSeq = version[agent]
  if (highestSeq == null) {
    return false
  } else {
    return highestSeq >= seq
  }

  // return highestSeq != null && highestSeq >= seq
}

function canInsertNow(item: Item, doc: Doc): boolean {
  // We need op.id to not be in doc.versions, but originLeft and originRight to be in.
  // We're also inserting each item from each agent in sequence.
  const [agent, seq] = item.id
  return !isInVersion(item.id, doc.version)
    && (seq === 0 || isInVersion([agent, seq - 1], doc.version))
    && isInVersion(item.originLeft, doc.version)
    && isInVersion(item.originRight, doc.version)
}

function mergeInto(dest: Doc, src: Doc) {
  const missing: (Item | null)[] = src.content.filter(item => !isInVersion(item.id, dest.version))
  let remaining = missing.length

  while (remaining > 0) {
    // Find the next item in remaining and insert it.
    let mergedOnThisPass = 0

    for (let i = 0; i < missing.length; i++) {
      const item = missing[i]
      if (item == null) continue
      if (!canInsertNow(item, dest)) continue

      // Insert it.
      remoteInsert(dest, item)
      missing[i] = null
      remaining--
      mergedOnThisPass++
    }

    if (mergedOnThisPass === 0) throw Error('Not making progress')
  }

  let srcIdx = 0, destIdx = 0
  while (srcIdx < src.content.length) {
    const srcItem = src.content[srcIdx]
    let destItem = dest.content[destIdx]

    while (!idEq(srcItem.id, destItem.id)) {
      destIdx++
      destItem = dest.content[destIdx]
    }

    if (srcItem.deleted) {
      destItem.deleted = true
    }

    srcIdx++
    destIdx++
  }
}


const doc1 = createDoc()
const doc2 = createDoc()

localInsert(doc1, 'a', 0, 'A')
localInsert(doc2, 'b', 0, 'B')

mergeInto(doc1, doc2)
mergeInto(doc2, doc1)

console.log('doc1 has content', getContent(doc1))
console.log('doc2 has content', getContent(doc2))

localDelete(doc1, 0, 1)
console.log('doc1 has content', getContent(doc1))

mergeInto(doc2, doc1)
console.log('doc2 has content', getContent(doc2))

console.table(doc2.content)


// localInsertOne(doc1, 'seph', 0, 'a')
// mergeInto(doc2, doc1)

// localInsertOne(doc1, 'seph', 1, 'b')
// localInsertOne(doc1, 'seph', 0, 'c')
// console.log('doc1 has content', getContent(doc1))
// console.table(doc1.content)

// mergeInto(doc2, doc1)
// console.log('doc2 has content', getContent(doc2))

// console.table(doc2.content)
