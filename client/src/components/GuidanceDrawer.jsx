import { useEffect } from 'react';

/**
 * GuidanceDrawer — Universal slide-in help drawer.
 *
 * Props:
 *   isOpen  {boolean}  — whether the drawer is visible
 *   onClose {function} — called when user closes the drawer
 *   guide   {object}   — { title, icon, sections: [{ heading, items: [string] }] }
 */
export default function GuidanceDrawer({ isOpen, onClose, guide }) {
  // Trap focus & block body scroll while open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!guide) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`guidance-drawer-backdrop ${isOpen ? 'open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Panel */}
      <aside
        className={`guidance-drawer ${isOpen ? 'open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={guide.title}
      >
        {/* Header */}
        <div className="guidance-drawer-header">
          <div className="guidance-drawer-title-row">
            {guide.icon && <span className="guidance-drawer-icon">{guide.icon}</span>}
            <h3 className="guidance-drawer-title">{guide.title}</h3>
          </div>
          <button
            type="button"
            className="guidance-drawer-close"
            onClick={onClose}
            aria-label="Close instructions"
            title="Close instructions"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="guidance-drawer-body">
          {(guide.sections || []).map((section, si) => (
            <div key={si} className="guidance-section">
              <h4 className="guidance-section-heading">
                {section.icon && <span className="guidance-section-icon">{section.icon}</span>}
                {section.heading}
              </h4>
              {section.type === 'grid' ? (
                /* Control-Map grid: items = [{ label, desc }] */
                <div className="guidance-control-grid">
                  {(section.items || []).map((item, ii) => (
                    <div key={ii} className="guidance-control-item">
                      <span className="guidance-control-label">{item.label}</span>
                      <span className="guidance-control-desc">{item.desc}</span>
                    </div>
                  ))}
                </div>
              ) : section.type === 'palette' ? (
                /* Special palette-color breakdown */
                <div className="guidance-palette-list">
                  {(section.items || []).map((item, ii) => (
                    <div key={ii} className="guidance-palette-item">
                      <span
                        className="guidance-palette-dot"
                        style={{ background: item.color }}
                        title={item.label}
                      />
                      <div className="guidance-palette-text">
                        <strong>{item.label}</strong>
                        <span>{item.desc}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                /* Default: bulleted list of strings */
                <ul className="guidance-tip-list">
                  {(section.items || []).map((item, ii) => (
                    <li key={ii} className="guidance-tip-item">
                      {typeof item === 'string' ? item : item.text || ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          <p className="guidance-drawer-footer">
            💡 Tip: Press <kbd>Esc</kbd> or tap outside to close this guide.
          </p>
        </div>
      </aside>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Pre-defined guide configs for each screen.
 * Import the relevant one in the screen component.
 * ───────────────────────────────────────────────────────────────────────────── */

export const GUIDES = {
  home: {
    title: 'Home Screen Instructions',
    icon: '🏠',
    sections: [
      {
        heading: 'Overview & Purpose',
        icon: '📌',
        items: [
          'This is the QuizFunnel Home Screen — your starting point for all quiz activities.',
          'Register with your Name, Mobile, Branch and a 4-digit PIN to begin a quiz attempt.',
          'Access Live Quiz Rooms, Self Practice, QR Scanner, and your Attempt History from the header.',
        ],
      },
      {
        heading: 'Control Map — What Each Button Does',
        icon: '🗺️',
        type: 'grid',
        items: [
          { label: '🌙 Theme Toggle', desc: 'Switch between Dark and Light display mode.' },
          { label: '📋 My Results', desc: 'View, expand, and delete past quiz attempt records.' },
          { label: '📷 QR Code', desc: 'Scan or display a QR code to share the quiz link.' },
          { label: '🏫 Quiz Rooms', desc: 'Join or create a real-time Host-managed quiz room.' },
          { label: '⚡ Self Practice', desc: 'Upload notes/PDFs and generate an AI-powered quiz.' },
          { label: 'Name / Mobile', desc: 'Enter your registered details to start a quiz session.' },
          { label: 'Branch Selector', desc: 'Choose your academic branch for relevant filtering.' },
          { label: 'PIN Field', desc: '4-digit security PIN to access your private result history.' },
          { label: 'Start Quiz →', desc: 'Submits the registration form and begins Level 1.' },
        ],
      },
      {
        heading: 'Pro-Tips & Workflow Steps',
        icon: '💡',
        items: [
          'Progress auto-saves — a mid-quiz browser refresh restores your session safely.',
          'Your 4-digit PIN is required to access "My Results". Set it once and remember it.',
          'Use the QR code to quickly share the quiz link with classmates on the same network.',
          'Self Practice uses Gemini Vision OCR — clearer photos give better question extraction.',
          'Room quiz requires a Host Room Code and Password shared by your instructor.',
        ],
      },
    ],
  },

  quiz: {
    title: 'Quiz Solving Instructions',
    icon: '🧩',
    sections: [
      {
        heading: 'Overview & Purpose',
        icon: '📌',
        items: [
          'You are in a multi-level timed quiz. Each level has a question set and a countdown timer.',
          'Answer as many questions as possible before the timer runs out to advance to the next level.',
          'Your score from each level is accumulated into a total. Unanswered questions score zero.',
        ],
      },
      {
        heading: 'Question Palette Colors',
        icon: '🎨',
        type: 'palette',
        items: [
          { label: 'Answered', color: '#22c55e', desc: 'You have selected an answer for this question.' },
          { label: 'Current', color: '#3b82f6', desc: 'The question you are currently viewing.' },
          { label: 'Marked for Review', color: '#f59e0b', desc: 'Bookmarked to revisit before submitting.' },
          { label: 'Unattempted', color: '#6b7280', desc: 'Not yet opened or answered.' },
        ],
      },
      {
        heading: 'Control Map — Buttons & Features',
        icon: '🗺️',
        type: 'grid',
        items: [
          { label: '⏱️ Timer Bar', desc: 'Countdown for the current level. Auto-submits on expiry.' },
          { label: '⬅️ / ➡️ Arrows', desc: 'Navigate to the previous or next question.' },
          { label: '🔖 Bookmark', desc: 'Mark a question for review — shows yellow in palette.' },
          { label: '✅ Submit Level', desc: 'Submit your answers for scoring. Warns if unattempted.' },
          { label: '🚪 Exit', desc: 'Leave the quiz. Prompts an exit confirmation modal.' },
          { label: 'Option A–D', desc: 'Click to select your answer for MCQ questions.' },
          { label: 'Text Input', desc: 'Type your numerical or short answer for Direct questions.' },
        ],
      },
      {
        heading: 'Pro-Tips & Level Rules',
        icon: '💡',
        items: [
          'Timer expires → auto-submission happens. All unanswered questions score 0.',
          'Level cutoffs: Levels 1–3 require a minimum score to advance (configurable by admin).',
          'You can change your answer at any time before submitting.',
          'Bookmark key questions to revisit them before the timer runs out.',
          'Tab-switching or leaving the window is detected as anti-cheating behaviour.',
          'On a room quiz: your progress is streamed live to the Host Dashboard in real time.',
        ],
      },
    ],
  },

  room: {
    title: 'Live Quiz Room Instructions',
    icon: '🏫',
    sections: [
      {
        heading: 'Overview & Purpose',
        icon: '📌',
        items: [
          'Live Quiz Rooms are Host-managed real-time competitive sessions.',
          'Up to 60 students can join the same room using a shared Room Code and Room Password.',
          'The Host (Admin) monitors all participants live and can approve re-attempt requests.',
        ],
      },
      {
        heading: 'Control Map — Join Form Fields',
        icon: '🗺️',
        type: 'grid',
        items: [
          { label: 'Room Code', desc: 'Unique code provided by your instructor (e.g. QUIZ88).' },
          { label: 'Room Password', desc: 'Secret password shared by the host to enter the room.' },
          { label: 'Full Name', desc: 'Your name as it will appear on the Host Dashboard.' },
          { label: 'Mobile Number', desc: '10-digit number used to identify your session.' },
          { label: 'Branch', desc: 'Your academic branch (CSE, ECE, etc.).' },
          { label: '4-Digit PIN', desc: 'Personal PIN to access your results after the quiz.' },
          { label: 'Join Room →', desc: 'Submits and enters the room if the room is still active.' },
        ],
      },
      {
        heading: 'Pro-Tips & Workflow',
        icon: '💡',
        items: [
          'If you already attempted this room, you must request a re-attempt from the Host.',
          'Re-attempt requests appear on the Host Live Dashboard — wait for the host to approve.',
          'Your PIN is used to access your "My Results" history after the quiz ends.',
          'Forgot PIN? Use "Forgot PIN?" → OTP reset flow to recover access.',
          'The host can close the room at any time — your submitted answers are always saved.',
        ],
      },
    ],
  },

  practice: {
    title: 'Self Practice Instructions',
    icon: '⚡',
    sections: [
      {
        heading: 'Overview & Purpose',
        icon: '📌',
        items: [
          'Self Practice uses Gemini Vision AI to extract questions from your notes and generate a quiz.',
          'Upload your question paper (PDF or images) and the AI will parse and generate a quiz in seconds.',
          'Practice quizzes are private — only you can see your results.',
        ],
      },
      {
        heading: 'Upload Rules & Limits',
        icon: '📤',
        type: 'grid',
        items: [
          { label: '📄 PDF Upload', desc: 'Single PDF file, maximum 15 MB. Clear, text-based PDFs work best.' },
          { label: '🖼️ Image Upload', desc: 'Up to 10 images (JPEG, PNG). Photographed pages or scanned sheets.' },
          { label: '⚠️ File Limit', desc: 'Cannot mix PDF and images. Choose one upload type per session.' },
          { label: '❓ Question Count', desc: 'Adjust how many questions to include from the scanned content.' },
          { label: '📝 MCQ Toggle', desc: 'Switch between Multiple-Choice (MCQ) and Direct/Numerical format.' },
          { label: '🤖 AI Parse', desc: 'Gemini Vision reads the file and extracts all detected questions.' },
        ],
      },
      {
        heading: 'Pro-Tips for Best Results',
        icon: '💡',
        items: [
          'Photograph question papers with good lighting and minimal shadows for highest OCR accuracy.',
          'Use PDF upload for printed/digital PDFs — it gives the most reliable extraction.',
          'After AI parse, you can edit individual questions before starting the quiz.',
          'MCQ mode requires 4 distinct options per question — AI auto-generates distractors if missing.',
          'Direct/Numerical mode accepts typed or numeric answers — ideal for math or formula-based Qs.',
          'Self-practice results are stored in "My Results" under the AI Practice tab.',
        ],
      },
    ],
  },

  history: {
    title: 'Attempt History Instructions',
    icon: '📋',
    sections: [
      {
        heading: 'Overview & Purpose',
        icon: '📌',
        items: [
          'Attempt History shows a complete log of all your past quiz sessions.',
          'Each attempt card shows the date, score, levels reached, and quiz type.',
          'Tap any card to expand a full level-by-level performance breakdown.',
        ],
      },
      {
        heading: 'Control Map — Cards & Actions',
        icon: '🗺️',
        type: 'grid',
        items: [
          { label: '📅 Date/Time', desc: 'When the attempt was submitted.' },
          { label: '🏆 Score Badge', desc: 'Total score out of maximum possible for levels attempted.' },
          { label: '📊 Level Reached', desc: 'The highest level you completed in that attempt.' },
          { label: '🔍 View Details', desc: 'Opens the full level-by-level score and time breakdown.' },
          { label: '🗑️ Delete Icon', desc: 'Permanently removes this attempt from your history.' },
          { label: '🏫 Room Badge', desc: 'Indicates this was a Host-managed live room quiz.' },
          { label: '⚡ AI Badge', desc: 'Indicates this was an AI Self-Practice session.' },
        ],
      },
      {
        heading: 'Pro-Tips',
        icon: '💡',
        items: [
          'Deleted attempts cannot be recovered — confirm carefully before deleting.',
          'Level breakdown shows per-level score and time taken for detailed performance analysis.',
          'Compare multiple attempts over time to track your improvement across topics.',
          'Room attempts and Self Practice attempts are grouped separately by badge type.',
        ],
      },
    ],
  },
};
