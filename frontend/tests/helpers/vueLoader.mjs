// Loader hook chỉ dùng cho test: resolve alias '@/' như vite.config.js và compile file .vue bằng @vue/compiler-sfc.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse, compileScript } from '@vue/compiler-sfc'

const srcUrl = new URL('../../src/', import.meta.url)

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const target = new URL(specifier.slice(2), srcUrl)
    const path = fileURLToPath(target)
    const url = existsSync(path) ? target : pathToFileURL(`${path}.js`)
    return { url: url.href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith('.vue')) return nextLoad(url, context)
  const filename = fileURLToPath(url)
  const { descriptor } = parse(await readFile(filename, 'utf8'), { filename })
  const { content } = compileScript(descriptor, { id: filename, inlineTemplate: true })
  return { format: 'module', source: content, shortCircuit: true }
}
