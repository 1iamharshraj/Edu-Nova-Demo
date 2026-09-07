import { z } from 'zod'
import { idStr } from '../../lib/validate'

export const CERTIFICATE_KINDS = ['TC', 'Bonafide', 'Character'] as const
export type CertificateKind = (typeof CERTIFICATE_KINDS)[number]

export const createCertificate = z.object({
  kind: z.enum(CERTIFICATE_KINDS),
  studentId: idStr,
})

export const listQuery = z.object({ studentId: idStr.optional(), kind: z.enum(CERTIFICATE_KINDS).optional() })
