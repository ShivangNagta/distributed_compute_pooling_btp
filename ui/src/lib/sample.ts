import type { Artifact } from '../types'

// Generated from coordinator/workloads and exports add(i32, i32) and
// compute(i32) -> i32.
const SAMPLE_WASM_BASE64 =
  'AGFzbQEAAAABDAJgAn9/AX9gAX8BfwMDAgABBAUBcAEBAQUDAQAQBxoDBm1lbW9yeQIAA2FkZAAAB2NvbXB1dGUAAQrnAQIHACABIABqC9wBAQJ/AkAgAEEBTg0AQZWa7zoPCyAAQQNxIQFBlZrvOiECAkACQCAAQQRJDQAgAEH8////B3EhAEGVmu86IQIDQCACQQ10IAJzIgJBEXYgAnMiAkEFdiACcyICQQ10IAJzIgJBEXYgAnMiAkEFdiACcyICQQ10IAJzIgJBEXYgAnMiAkEFdiACcyICQQ10IAJzIgJBEXYgAnMiAkEFdiACcyECIABBfGoiAA0ACyABRQ0BCwNAIAJBDXQgAnMiAkERdiACcyICQQV2IAJzIQIgAUF/aiIBDQALCyACCwArBG5hbWUAExJidHBfd29ya2xvYWRzLndhc20BDwIAA2FkZAEHY29tcHV0ZQBNCXByb2R1Y2VycwIIbGFuZ3VhZ2UBBFJ1c3QADHByb2Nlc3NlZC1ieQEFcnVzdGMdMS45OS4xICg1OGNmOGY5YzMgMjAyNi0xMC0xMykAlAEPdGFyZ2V0X2ZlYXR1cmVzCCsLYnVsay1tZW1vcnkrD2J1bGstbWVtb3J5LW9wdCsWY2FsbC1pbmRpcmVjdC1vdmVybG9uZysKbXVsdGl2YWx1ZSsPbXV0YWJsZS1nbG9iYWxzKxNub250cmFwcGluZy1mcHRvaW50Kw9yZWZlcmVuY2UtdHlwZXMrCHNpZ24tZXh0'

export const SAMPLE_ENTRY_POINT = 'add'

export const LOOP_ENTRY_POINT = 'compute'

export function sampleArtifact(): Artifact {
  return {
    entry_point: SAMPLE_ENTRY_POINT,
    files: [
      {
        name: 'add.wasm',
        content: SAMPLE_WASM_BASE64,
        mime: 'application/wasm',
      },
    ],
  }
}

export function loopArtifact(): Artifact {
  return {
    entry_point: LOOP_ENTRY_POINT,
    files: [
      {
        name: 'compute.wasm',
        content: SAMPLE_WASM_BASE64,
        mime: 'application/wasm',
      },
    ],
  }
}
