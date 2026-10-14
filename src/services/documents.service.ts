import { getDocumentForUser } from '../repositories/documents.repository'
import { DOCUMENT_FAILED_MESSAGE, DOCUMENT_PROCESSING_MESSAGE } from '../config'
import { notFound, rejected } from '../utils/pipelineLogger'

// BG.3 — "can this user chat with / quiz this one document right now?",
// shared by chat.service (single-document mode) and quiz.service.
//
// Three answers, in this order:
//   404  not theirs, or doesn't exist (auth rule: never say which)
//   409  theirs, but 'processing' (the worker is still embedding it) or
//        'failed' (every attempt used up). 409 Conflict, not 404: the
//        document exists and is yours, it just isn't in a usable state.
//   ok   'ready'
// Ownership comes first: telling a stranger "still processing" would confirm
// that the id exists.
//
// Checked BEFORE embedding the question, so a request that can't succeed
// doesn't spend a Gemini call. Same `{ ok: false, status, error }` shape as
// prepareChat()/generateQuiz(), and like them it never touches req/res.
export async function checkDocumentReady(
  documentId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const document = await getDocumentForUser(documentId, userId)

  if (!document) {
    notFound(`no document ${documentId} for user ${userId.slice(0, 8)}`)
    return { ok: false, status: 404, error: 'No document found with that documentId' }
  }
  if (document.status === 'processing') {
    rejected(`"${document.filename}" is still processing`)
    return { ok: false, status: 409, error: DOCUMENT_PROCESSING_MESSAGE }
  }
  if (document.status === 'failed') {
    rejected(`"${document.filename}" failed to process`)
    return { ok: false, status: 409, error: DOCUMENT_FAILED_MESSAGE }
  }
  return { ok: true }
}
