
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

function localInsertOne(doc: Doc, agent: string, pos: number, text: string) {
  // let seq = 0
  // if (doc.version[agent] != null) {
  //   seq = doc.version[agent] + 1
  // }

  const seq = (doc.version[agent] ?? -1) + 1
  integrate(doc, {
    content: text,
    id: [agent, seq],
    deleted: false,
    originLeft: doc.content[pos - 1]?.id ?? null,
    originRight: doc.content[pos]?.id ?? null,
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


const doc = createDoc()
localInsertOne(doc, 'seph', 0, 'a')
localInsertOne(doc, 'seph', 1, 'b')
localInsertOne(doc, 'seph', 0, 'c')
console.log('doc has content', getContent(doc))
console.table(doc.content)
