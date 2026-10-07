import { useState } from 'react';
import { Bot, Send, X, Sparkles, AlertOctagon, Loader, ChevronsUp } from 'lucide-react';
import { agentApi, errorMessage } from '../../services/api';
import './MentorChat.css';

const TIER_LABELS = { 1: 'Nudge', 2: 'Diagnostic', 3: 'Syntax help' };

/** Render `backticked` parts of a hint as inline code. */
function renderInlineCode(text) {
  return String(text).split('`').map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part));
}

export default function MentorChat({ unitId, currentStep, stepTitle, sessionId, onClose }) {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState([
    {
      sender: 'mentor',
      text: "Hi! I'm your OpsAcademy mentor. Tell me where you're stuck. I start with a nudge, and you can ask for a stronger hint if you need one.",
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [lastQuestion, setLastQuestion] = useState('');
  const [nextTier, setNextTier] = useState(null);

  const ask = async (text, tier) => {
    setMessages((prev) => [...prev, { sender: 'user', text: tier ? `I need a stronger hint (${TIER_LABELS[tier]}).` : text }]);
    setLoading(true);
    setNextTier(null);

    try {
      const res = await agentApi.getHint({ query: text, unitId, stepNumber: currentStep, sessionId, tier });
      const data = res.data?.data || {};

      if (data.blocked) {
        setMessages((prev) => [...prev, { sender: 'mentor', text: data.message || 'I can\'t help with that command.', blocked: true }]);
      } else {
        setMessages((prev) => [...prev, { sender: 'mentor', text: data.hint, tier: data.tier, fallback: data.fallback }]);
        setNextTier(data.nextTier);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { sender: 'mentor', text: errorMessage(err, 'The mentor is unavailable right now. Please try again in a moment.'), blocked: true },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = (e) => {
    e?.preventDefault();
    const text = query.trim();
    if (!text || loading) return;
    setQuery('');
    setLastQuestion(text);
    ask(text);
  };

  return (
    <div className="mentor-chat-drawer glass-card animate-slide-left">
      <div className="mentor-chat-header">
        <div className="mentor-title-area">
          <div className="mentor-avatar">
            <Bot size={18} />
          </div>
          <div>
            <h3>AI Mentor</h3>
            <span className="mentor-status-text">
              <Sparkles size={12} /> Step {currentStep}{stepTitle ? `: ${stepTitle}` : ''}
            </span>
          </div>
        </div>
        <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close mentor">
          <X size={18} />
        </button>
      </div>

      <div className="mentor-messages">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`mentor-msg ${msg.sender === 'user' ? 'msg-user' : 'msg-mentor'} ${
              msg.blocked ? 'msg-blocked' : ''
            }`}
          >
            {msg.sender === 'mentor' && (
              <div className="msg-avatar">
                {msg.blocked ? <AlertOctagon size={14} /> : <Bot size={14} />}
              </div>
            )}
            <div className="msg-bubble">
              {msg.tier && (
                <span className={`msg-tier tier-${msg.tier}`}>
                  Hint {msg.tier} of 3 · {TIER_LABELS[msg.tier]}
                  {msg.fallback ? ' · offline mode' : ''}
                </span>
              )}
              <p>{renderInlineCode(msg.text)}</p>
            </div>
          </div>
        ))}

        {loading && (
          <div className="mentor-msg msg-mentor">
            <div className="msg-avatar">
              <Bot size={14} />
            </div>
            <div className="msg-bubble loading-bubble">
              <Loader size={16} className="spin" />
              <span>{sessionId ? 'Looking at your sandbox...' : 'Thinking...'}</span>
            </div>
          </div>
        )}

        {!loading && nextTier && lastQuestion && (
          <button className="btn btn-secondary btn-sm mentor-escalate" onClick={() => ask(lastQuestion, nextTier)}>
            <ChevronsUp size={14} /> Still stuck? Get a stronger hint ({TIER_LABELS[nextTier]})
          </button>
        )}
      </div>

      <form className="mentor-input-form" onSubmit={handleSend}>
        <input
          type="text"
          className="input mentor-input"
          placeholder="Describe where you're stuck, or paste the error..."
          value={query}
          maxLength={1000}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="btn btn-primary btn-icon" disabled={loading || !query.trim()} aria-label="Send">
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
