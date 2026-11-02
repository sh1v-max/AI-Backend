import { listDocuments } from '../repositories/documents.repository'
import { agentDetail } from '../utils/pipelineLogger'

// AG.5 — the quiz OFFER ("Kind B" in agents-plan.md §2.6).
//
// When the router labels a message quiz_request ("quiz me on this"), nobody
// writes a quiz yet. Code writes a short reply offering one, plus an `action`
// the frontend turns into a "Create quiz" button. Only the click makes the
// quiz, through the existing POST /quiz (auth, ownership, 409 while
// processing, validate → retry once → shuffle: all already there).
//
// Why not give the model a createQuiz tool? Because a quiz is something the
// app DOES, not something the model needs to read. The router labels, code
// proposes, a human confirms, code acts. The model never gets to start it.
//
// Why a button, not a typed "yes"? A typed "yes" arrives as a NEW request, so
// the server would have to remember the pending offer between two requests
// (a row per session, a timeout, what if they say "yes" to something else…).
// That's suspend/resume, Phase 8's whole topic. The click needs no memory:
// the button already carries the documentId.
//
// No LLM call anywhere in here: the reply is a template. That's on purpose —
// it's instant, free, and it can't promise something the app can't do.

// What the button does. Sent to the client as the `action` SSE event (and
// `action` in /chat's JSON). Not saved: after a reload the offer is plain text.
export type ChatAction =
  // one document: the button generates that document's quiz
  | { type: 'quiz'; documentId: string; filename: string }
  // "All documents" with several ready: the button opens the document picker
  | { type: 'quiz_picker' }

export type QuizOffer = {
  // the assistant's reply, saved to history like any other answer
  text: string
  // null = nothing to offer (no ready documents): plain text, no button
  action: ChatAction | null
}

// `one` = the chat's single document (already checked: it's the caller's and
// it's ready, by checkDocumentReady in prepareChat). Absent = "All documents".
export async function buildQuizOffer(
  userId: string,
  one?: { documentId: string; filename: string },
): Promise<QuizOffer> {
  if (one) {
    agentDetail(`quiz offer: one document → "${one.filename}"`)
    return {
      text: `I can make a 5-question multiple-choice quiz from **${one.filename}**. Want it?`,
      action: { type: 'quiz', documentId: one.documentId, filename: one.filename },
    }
  }

  // "All documents": which of the caller's documents could a quiz use?
  // Only ready ones (POST /quiz answers 409 for the others anyway).
  const docs = await listDocuments(userId)
  const ready = docs.filter((d) => d.status === 'ready')

  if (ready.length === 1) {
    const [doc] = ready
    agentDetail(`quiz offer: all documents, 1 ready → "${doc.filename}"`)
    return {
      text: `I can make a 5-question multiple-choice quiz from **${doc.filename}**. Want it?`,
      action: { type: 'quiz', documentId: doc.id, filename: doc.filename },
    }
  }

  if (ready.length > 1) {
    agentDetail(`quiz offer: all documents, ${ready.length} ready → the picker`)
    return {
      text: `A quiz covers one document at a time, and you have ${ready.length}. Pick one and I'll make a 5-question multiple-choice quiz from it.`,
      action: { type: 'quiz_picker' },
    }
  }

  // Nothing ready: say why, no button (a button would only lead to an error)
  const processing = docs.some((d) => d.status === 'processing')
  agentDetail(`quiz offer: no ready documents (${processing ? 'one still processing' : 'none uploaded'}) → no button`)
  return {
    text: processing
      ? "Your document is still being processed. Once it's ready, I can make a 5-question quiz from it."
      : 'Upload a PDF first, and I can make a 5-question multiple-choice quiz from it.',
    action: null,
  }
}
