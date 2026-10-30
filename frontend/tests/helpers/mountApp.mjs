// Mount Vue app thật bằng custom renderer trên cây node JS thuần (không cần jsdom).
// Chỉ hỗ trợ đủ cho test: element, text, comment, props/attrs và handler sự kiện.
import { createRenderer, nextTick } from 'vue'

// Đích của <Teleport to="body"> (vd. AppModal); mỗi lần mount có một body riêng.
let currentBody = null

function createNode(fields) {
  // listeners: chỉ directive như v-model gọi addEventListener; test tự gọi listener để mô phỏng gõ phím.
  const node = { parent: null, children: [], props: {}, listeners: {}, ...fields }
  node.addEventListener = (type, fn) => { (node.listeners[type] ||= []).push(fn) }
  node.removeEventListener = (type, fn) => { node.listeners[type] = (node.listeners[type] || []).filter((f) => f !== fn) }
  return node
}

const nodeOps = {
  createElement: (tag) => createNode({ tag }),
  createText: (text) => createNode({ text }),
  createComment: (text) => createNode({ comment: text }),
  setText: (node, text) => { node.text = text },
  setElementText: (el, text) => {
    for (const child of el.children) child.parent = null
    el.children = text ? [createNode({ text, parent: el })] : []
  },
  insert: (child, parent, anchor) => {
    if (child.parent) nodeOps.remove(child)
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index === -1) parent.children.push(child)
    else parent.children.splice(index, 0, child)
    child.parent = parent
  },
  remove: (child) => {
    const parent = child.parent
    if (!parent) return
    parent.children.splice(parent.children.indexOf(child), 1)
    child.parent = null
  },
  parentNode: (node) => node.parent,
  nextSibling: (node) => {
    const siblings = node.parent?.children ?? []
    return siblings[siblings.indexOf(node) + 1] ?? null
  },
  querySelector: (selector) => (selector === 'body' ? currentBody : null),
  setScopeId: () => {},
}

const { createApp } = createRenderer({
  ...nodeOps,
  patchProp: (el, key, _prev, next) => {
    if (next === null || next === undefined || next === false) delete el.props[key]
    else el.props[key] = next
  },
})

export function textOf(node) {
  if (node.text !== undefined) return node.text
  return node.children.map(textOf).join('')
}

export function findAll(node, predicate, found = []) {
  if (node.tag && predicate(node)) found.push(node)
  for (const child of node.children) findAll(child, predicate, found)
  return found
}

export const byTest = (name) => (node) => node.props['data-test'] === name

// Chờ các promise (request giả, lazy route component) và lượt render của Vue hoàn tất.
export async function flush(times = 5) {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setImmediate(resolve))
    await nextTick()
  }
}

export function mountApp(rootComponent, plugins) {
  const root = createNode({ tag: 'root' })
  const body = createNode({ tag: 'body' })
  currentBody = body
  const app = createApp(rootComponent)
  for (const plugin of plugins) app.use(plugin)
  app.mount(root)
  // Nội dung teleport nằm ở body, nên text/find tìm cả root lẫn body.
  return {
    root,
    body,
    unmount: () => app.unmount(),
    text: () => textOf(root) + textOf(body),
    find: (name) => [...findAll(root, byTest(name)), ...findAll(body, byTest(name))],
  }
}

// Sự kiện tối thiểu để RouterLink và @click chạy như trình duyệt (chuột trái, không phím bổ trợ).
// Vue gộp listener của component cha và RouterLink thành mảng khi cùng gắn onClick.
export function click(node) {
  const event = { button: 0, defaultPrevented: false, preventDefault() {}, currentTarget: null }
  const handlers = [node.props.onClick].flat().filter((handler) => typeof handler === 'function')
  return Promise.all(handlers.map((handler) => handler(event)))
}
