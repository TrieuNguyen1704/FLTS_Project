import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'

const sourceUrl = new URL('../src/components/FileDropzone.vue', import.meta.url)
const { descriptor } = parse(await readFile(sourceUrl, 'utf8'))
const script = compileScript(descriptor, { id: 'dropzone-test' }).content
const template = compileTemplate({
  id: 'dropzone-test', filename: 'FileDropzone.vue', source: descriptor.template.content,
  ssr: true, ssrCssVars: [], compilerOptions: { bindingMetadata: compileScript(descriptor, { id: 'dropzone-test' }).bindings },
}).code
const generatedUrl = new URL(`.dropzone-${process.pid}.mjs`, import.meta.url)
let component
try {
  await writeFile(generatedUrl, `${script.replace('export default', 'const component =')}\n${template}\ncomponent.ssrRender = ssrRender;\nexport default component;`)
  component = (await import(generatedUrl.href)).default
} finally {
  await unlink(generatedUrl).catch(() => {})
}

function setup() {
  return component.setup({ busy: false, progress: 0 }, { expose() {}, emit() {} })
}

test('accepts a PDF up to the 20 MiB boundary', () => {
  const state = setup()
  state.choose([{ name: 'lesson.pdf', size: 20 * 1024 * 1024 }])
  assert.equal(state.selected.value.name, 'lesson.pdf')
  assert.equal(state.error.value, '')
})
test('invalid extension clears a previously selected file', () => {
  const state = setup()
  state.choose([{ name: 'lesson.pdf', size: 1024 }])
  state.choose([{ name: 'bad.exe', size: 1024 }])
  assert.equal(state.selected.value, null)
  assert.match(state.error.value, /PDF/)
})
test('oversize and empty files are rejected', () => {
  const state = setup()
  for (const size of [20 * 1024 * 1024 + 1, 0]) {
    state.choose([{ name: 'lesson.docx', size }])
    assert.equal(state.selected.value, null)
    assert.ok(state.error.value)
  }
})
test('a drop accepts one file but refuses multiple files', () => {
  const state = setup()
  const files = [{ name: 'lesson.doc', size: 1024 }]
  state.dropped({ dataTransfer: { files } }, false)
  assert.equal(state.selected.value.name, 'lesson.doc')
  state.dropped({ dataTransfer: { files: [...files, ...files] } }, false)
  assert.equal(state.selected.value, null)
  assert.match(state.error.value, /một tài liệu/)
})
test('a drop cannot change the selected file while uploading', () => {
  const state = setup()
  state.choose([{ name: 'first.pdf', size: 1024 }])
  state.dropped({ dataTransfer: { files: [{ name: 'second.pdf', size: 1024 }] } }, true)
  assert.equal(state.selected.value.name, 'first.pdf')
})
test('renders the supplied byte progress rather than a simulated timer', async () => {
  const html = await renderToString(createSSRApp(component, { busy: true, progress: 37 }))
  assert.match(html, /value="37"/)
  assert.match(html, /Đang tải: 37%/)
})
test('100 percent says waiting for confirmation, not upload success', async () => {
  const html = await renderToString(createSSRApp(component, { busy: true, progress: 100 }))
  assert.match(html, /Đang chờ hệ thống xác nhận lưu/)
})
