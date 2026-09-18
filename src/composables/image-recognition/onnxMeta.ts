/**
 * 读 ONNX 模型里的 metadata_props。
 *
 * 模型工坊导出的 .onnx 会把自己的类别表、输入尺寸、裁切系数写进 metadata，
 * 所以应用拿到模型就知道输出第几维对应哪个棋子，不用让用户再填一遍。
 *
 * 只解析需要的那几个顶层字段，不引入 protobuf 依赖 ——
 * 一个完整的 ONNX 解析器有几十 KB，而这里只要走一遍 wire format。
 */

export interface OnnxMetadata {
  labels: string[]
  inputSize: number
  inputLayout: string
  output: string
  grid: string
  cropK: number
}

/** 读 varint。用取模而不是位运算：值可能超过 2^31，位运算会先截成 int32 */
function readVarint(buf: Uint8Array, i: number): [number, number] {
  let v = 0
  let shift = 0
  let byte: number
  do {
    byte = buf[i++]
    v += (byte & 0x7f) * Math.pow(2, shift)
    shift += 7
  } while (byte & 0x80)
  return [v, i]
}

const decoder = new TextDecoder()

/** 读掉一个 varint 并返回新位置，不产生未使用的绑定 */
function skipVarint(buf: Uint8Array, i: number): number {
  const [, next] = readVarint(buf, i)
  return next
}

/** 解析 metadata_props（ModelProto field 14）里的 key-value。
 *  每条是 StringStringEntryProto：field1 = key，field2 = value。 */
function parseMetadataProps(bytes: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {}
  let i = 0
  while (i < bytes.length) {
    let tag: number
    try {
      ;[tag, i] = readVarint(bytes, i)
    } catch {
      break
    }
    const field = tag >> 3
    const wire = tag & 7

    if (wire === 2) {
      let len: number
      ;[len, i] = readVarint(bytes, i)
      const end = i + len
      if (end > bytes.length) break

      if (field === 14) {
        const sub = bytes.subarray(i, end)
        const kv: Record<number, string> = {}
        let j = 0
        while (j < sub.length) {
          let t: number
          ;[t, j] = readVarint(sub, j)
          const f = t >> 3
          const w = t & 7
          if (w === 2) {
            let l: number
            ;[l, j] = readVarint(sub, j)
            kv[f] = decoder.decode(sub.subarray(j, j + l))
            j += l
          } else if (w === 0) {
            j = skipVarint(sub, j)
          } else {
            break
          }
        }
        if (kv[1]) out[kv[1]] = kv[2] ?? ''
      }
      i = end
    } else if (wire === 0) {
      i = skipVarint(bytes, i)
    } else if (wire === 5) {
      i += 4
    } else if (wire === 1) {
      i += 8
    } else {
      break
    }
  }
  return out
}

/** 从模型字节里抽出应用关心的那几项。读不到就返回 null，调用方回退到默认值。 */
export function readOnnxMetadata(bytes: Uint8Array): OnnxMetadata | null {
  let raw: Record<string, string>
  try {
    raw = parseMetadataProps(bytes)
  } catch {
    return null
  }
  if (!raw || !Object.keys(raw).length) return null

  const labels = raw.labels
    ? raw.labels
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : []

  let inputSize = 0
  const m = /^(\d+)\s*[x×]\s*(\d+)$/.exec((raw.input_size || '').trim())
  if (m) inputSize = parseInt(m[1], 10)

  const cropK = parseFloat(raw.crop_k || '')

  return {
    labels,
    inputSize: Number.isFinite(inputSize) ? inputSize : 0,
    inputLayout: raw.input_layout || '',
    output: raw.output || '',
    grid: raw.grid || '',
    cropK: Number.isFinite(cropK) && cropK > 0 ? cropK : 1.14,
  }
}
