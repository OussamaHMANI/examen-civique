function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function initQuiz(options) {
  const {
    questionsBank,
    totalQuestions = questionsBank.length,
    selectors = {},
    examDurationMinutes = null  // Ajouter support du timer optionnel
  } = options;

  const {
    quiz = "#quiz",
    progress = "#progress",
    question = "#question",
    choices = "#choices",
    nextBtn = "#nextBtn",
    result = "#result",
    timer = "#timer"  // Ajouter support du sélecteur timer
  } = selectors;

  const quizEl = document.querySelector(quiz);
  const progressEl = document.querySelector(progress);
  const questionEl = document.querySelector(question);
  const choicesEl = document.querySelector(choices);
  const nextBtnEl = document.querySelector(nextBtn);
  const resultEl = document.querySelector(result);
  const timerEl = document.querySelector(timer);

  if (!questionsBank || !Array.isArray(questionsBank) || questionsBank.length === 0) {
    return;
  }

  if (!quizEl || !progressEl || !questionEl || !choicesEl || !nextBtnEl || !resultEl) {
    return;
  }

  let questions = shuffle(questionsBank).slice(0, totalQuestions);
  let currentIndex = 0;
  let score = 0;
  let userAnswers = [];
  let selectedChoiceIndex = null;
  let locked = false;
  let currentRenderedChoices = [];
  let timerInterval = null;
  let remainingSeconds = null;

  // Déclarer showResult avant de l'utiliser dans le timer
  function showResult() {
    const total = questions.length;
    const noteSur40 = score;
    const examDuration = Math.round((new Date() - examStartTime) / 1000); // in seconds

    // Save exam result if it's a complete exam
    if (examType === "complete") {
      saveExamResultIfComplete({
        type: "complete",
        score: score,
        totalQuestions: total,
        timestamp: new Date().toISOString(),
        duration: examDuration
      });
    }

    quizEl.style.display = "none";
    resultEl.style.display = "block";

    let html = `
      <h2>Resultats</h2>
      <p>Vous avez obtenu <strong>${score} / ${total}</strong>, soit une note de <strong>${noteSur40} / ${totalQuestions}</strong>.</p>
      <p>Resume des reponses :</p>
    `;

    userAnswers.forEach((entry, index) => {
      html += `
        <div class="summary-item">
          <strong>Q${index + 1}.</strong> ${entry.question}<br>
          Votre reponse : <span class="${entry.isCorrect ? "tag-good" : "tag-bad"}">
            ${entry.chosen} (${entry.isCorrect ? "Juste" : "Faux"})
          </span><br>
          Bonne reponse : <strong>${entry.correct}</strong>
        </div>
      `;
    });

    html += `
      <button class="restart-btn" id="restart-quiz-btn">Recommencer un nouveau QCM</button>
    `;

    resultEl.innerHTML = html;
    const restartBtn = document.getElementById("restart-quiz-btn");
    if (restartBtn) {
      restartBtn.addEventListener("click", restartQuiz);
    }
  }

  // Timer setup
  if (examDurationMinutes && timerEl) {
    remainingSeconds = examDurationMinutes * 60;

    function updateTimerDisplay() {
      const minutes = Math.floor(remainingSeconds / 60);
      const seconds = remainingSeconds % 60;
      timerEl.textContent = `⏱️ ${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    function startTimer() {
      updateTimerDisplay();
      timerInterval = setInterval(() => {
        remainingSeconds--;
        updateTimerDisplay();
        if (remainingSeconds <= 0) {
          clearInterval(timerInterval);
          showResult();
        }
      }, 1000);
    }

    // Start timer when quiz loads
    setTimeout(startTimer, 100);
  }

  function renderQuestion() {
    const q = questions[currentIndex];
    questionEl.textContent = q.question;
    progressEl.textContent = `Question ${currentIndex + 1} / ${questions.length}`;

    choicesEl.innerHTML = "";
    selectedChoiceIndex = null;
    locked = false;
    nextBtnEl.disabled = true;

    currentRenderedChoices = shuffle(
      q.choices.map((text, idx) => ({
        text,
        isCorrect: idx === q.correctIndex
      }))
    );

    currentRenderedChoices.forEach((choiceObj, index) => {
      const btn = document.createElement("button");
      btn.className = "choice-btn";
      btn.textContent = choiceObj.text;
      btn.addEventListener("click", () => handleChoiceClick(index));
      choicesEl.appendChild(btn);
    });
  }

  function handleChoiceClick(index) {
    if (locked) {
      return;
    }

    selectedChoiceIndex = index;
    nextBtnEl.disabled = false;

    const buttons = Array.from(choicesEl.querySelectorAll(".choice-btn"));
    buttons.forEach((btn, i) => {
      btn.classList.toggle("selected", i === index);
    });
  }

  function validateAnswer() {
    if (selectedChoiceIndex === null) {
      return;
    }

    const buttons = Array.from(choicesEl.querySelectorAll(".choice-btn"));
    locked = true;
    nextBtnEl.disabled = false;

    const correctRenderedIndex = currentRenderedChoices.findIndex((choice) => choice.isCorrect);

    buttons.forEach((btn, i) => {
      btn.classList.remove("selected");
      if (i === correctRenderedIndex) {
        btn.classList.add("correct");
      }
      if (i === selectedChoiceIndex && i !== correctRenderedIndex) {
        btn.classList.add("incorrect");
      }
    });

    const isCorrect = currentRenderedChoices[selectedChoiceIndex].isCorrect;
    if (isCorrect) {
      score += 1;
    }

    userAnswers.push({
      question: questions[currentIndex].question,
      chosen: currentRenderedChoices[selectedChoiceIndex].text,
      correct: currentRenderedChoices[correctRenderedIndex].text,
      isCorrect
    });
  }


  function restartQuiz() {
    questions = shuffle(questionsBank).slice(0, totalQuestions);
    currentIndex = 0;
    score = 0;
    userAnswers = [];

    quizEl.style.display = "block";
    resultEl.style.display = "none";

    nextBtnEl.textContent = "Valider";
    renderQuestion();
  }

  nextBtnEl.addEventListener("click", () => {
    if (!locked) {
      validateAnswer();
      if (currentIndex < questions.length - 1) {
        nextBtnEl.textContent = "Question suivante";
      } else {
        nextBtnEl.textContent = "Voir les resultats";
      }
      return;
    }

    if (currentIndex < questions.length - 1) {
      currentIndex += 1;
      nextBtnEl.textContent = "Valider";
      renderQuestion();
    } else {
      showResult();
    }
  });

  nextBtnEl.textContent = "Valider";
  renderQuestion();
}
