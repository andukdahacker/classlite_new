/**
 * questionCardModel — maps the 7-4a wire types (Question + QuestionReply) to the
 * presentational AnchoredQuestionCard view-model (Story 7.4b, AC14). Lives in the
 * feature (the card is domain + presentational and must not import wire types).
 * A `t` translator is threaded in so the anchor-location caption resolves in the
 * caller's locale (UX-2) without the card owning Q&A copy.
 */
import type {
  AnchoredQuestion,
  AnchorTone,
} from '@/components/domain/AnchoredQuestionCard'
import type { Role } from '@/hooks/useRole'
import type { Question, QuestionReply } from '../api/useQuestions'

type Translate = (key: string) => string

const STUDENT_ROLE: Role = 'student'

function anchorTone(question: Question): AnchorTone {
  return question.anchorType === 'item' ? 'item' : 'exercise'
}

/** Human-readable anchor-location caption from the positional anchor (best-effort). */
function anchorLocation(question: Question, t: Translate): string {
  if (question.anchorType === 'exercise') return t('questions.anchor.wholeExercise')
  const anchor = question.anchorRef
  if (anchor && anchor.charStart !== null && anchor.charEnd !== null) {
    return t('questions.anchor.passage')
  }
  return t('questions.anchor.item')
}

function excerptText(question: Question, location: string): string {
  // The ask-time anchor_excerpt snapshot is display-authoritative (D2); fall back
  // to the location label for a whole-exercise anchor with no snapshot.
  return question.anchorExcerpt ?? location
}

/** Teacher-console card (s18) — answer variant, always awaiting until resolved. */
export function toTeacherCardModel(
  question: Question,
  t: Translate,
  formatTimestamp: (iso: string) => string,
): AnchoredQuestion {
  const location = anchorLocation(question, t)
  return {
    id: question.id,
    variant: 'teacher-answer',
    state: question.status === 'resolved' ? 'answered' : 'awaiting',
    asker: {
      name: question.studentName ?? t('questions.card.unknownAsker'),
      avatarUrl: question.studentAvatarUrl,
      role: STUDENT_ROLE,
    },
    questionText: question.content,
    anchoredExcerpt: { text: excerptText(question, location), location },
    anchorTone: anchorTone(question),
    askedAt: question.createdAt,
    askedAtLabel: formatTimestamp(question.createdAt),
  }
}

/**
 * Student-rail card (s36) — ask variant. `answered` when a reader-visible reply
 * exists; the latest reply is shown (author + relative time). The panel passes
 * a pre-formatted `timestampLabel` (TS-6 — i18n formats, never `new Date()`).
 */
export function toStudentCardModel(
  question: Question,
  replies: QuestionReply[],
  t: Translate,
  formatRelative: (iso: string) => string,
): AnchoredQuestion {
  const location = anchorLocation(question, t)
  const latest = replies.length > 0 ? replies[replies.length - 1] : undefined
  return {
    id: question.id,
    variant: 'student-ask',
    state: latest ? 'answered' : 'awaiting',
    asker: {
      name: question.studentName ?? t('questions.card.unknownAsker'),
      avatarUrl: question.studentAvatarUrl,
      role: STUDENT_ROLE,
    },
    questionText: question.content,
    anchoredExcerpt: { text: excerptText(question, location), location },
    anchorTone: anchorTone(question),
    askedAt: question.createdAt,
    askedAtLabel: formatRelative(question.createdAt),
    teacherReply: latest
      ? {
          name: latest.authorName ?? t('questions.card.unknownAuthor'),
          avatarUrl: latest.authorAvatarUrl,
          text: latest.content,
          timestamp: latest.createdAt,
          timestampLabel: formatRelative(latest.createdAt),
        }
      : undefined,
  }
}
