// Shared quiz behavior for lessons. No build step, no dependencies.
// Two widget shapes, both driven by data attributes so a lesson author
// never has to write JS by hand:
//
// Multiple choice:
//   <div class="quiz" data-quiz>
//     <p class="prompt">...</p>
//     <button class="opt" data-correct>Right option</button>
//     <button class="opt">Wrong option</button>
//     <div class="feedback good" data-feedback-good>Why it's right.</div>
//     <div class="feedback bad" data-feedback-bad>Why that's not it.</div>
//   </div>
//
// Short answer (case-insensitive, trims whitespace, accepts a
// pipe-separated list of acceptable answers):
//   <div class="quiz short" data-quiz-short data-answer="head|the head node">
//     <p class="prompt">...</p>
//     <input type="text" placeholder="type your answer">
//     <button>Check</button>
//     <div class="feedback good" data-feedback-good>Why it's right.</div>
//     <div class="feedback bad" data-feedback-bad>Nudge, not the answer.</div>
//   </div>

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-quiz]').forEach((quiz) => {
    const opts = Array.from(quiz.querySelectorAll('.opt'));
    const good = quiz.querySelector('[data-feedback-good]');
    const bad = quiz.querySelector('[data-feedback-bad]');
    opts.forEach((opt) => {
      opt.addEventListener('click', () => {
        const isCorrect = opt.hasAttribute('data-correct');
        opts.forEach((o) => { o.disabled = true; });
        opt.classList.add(isCorrect ? 'correct' : 'wrong');
        if (!isCorrect) {
          const correctOpt = opts.find((o) => o.hasAttribute('data-correct'));
          if (correctOpt) correctOpt.classList.add('correct');
        }
        if (good) good.classList.toggle('show', isCorrect);
        if (bad) bad.classList.toggle('show', !isCorrect);
      }, { once: true });
    });
  });

  document.querySelectorAll('[data-quiz-short]').forEach((quiz) => {
    const input = quiz.querySelector('input[type=text]');
    const button = quiz.querySelector('button');
    const good = quiz.querySelector('[data-feedback-good]');
    const bad = quiz.querySelector('[data-feedback-bad]');
    const accepted = (quiz.getAttribute('data-answer') || '')
      .split('|').map((s) => s.trim().toLowerCase()).filter(Boolean);

    const check = () => {
      const value = input.value.trim().toLowerCase();
      const isCorrect = accepted.includes(value);
      if (good) good.classList.toggle('show', isCorrect);
      if (bad) bad.classList.toggle('show', !isCorrect);
      input.style.borderColor = isCorrect ? 'var(--cyan)' : 'var(--red)';
    };

    button.addEventListener('click', check);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
  });
});
