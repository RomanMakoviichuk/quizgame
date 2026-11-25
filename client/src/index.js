import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { installAudioLeveler } from './game/audioLeveler';
import { installLiteMode } from './game/liteMode';
import MediaPreloader from './components/MediaPreloader';
import SoundUnlock from './components/SoundUnlock';
import ExamStudent from './exam/ExamStudent';
import ExamTeacher from './exam/ExamTeacher';

// sounds and videos play at their own recorded volume (the leveler is off)
const isPhone = window.innerWidth <= 768 || /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent);
// if (!isPhone) installAudioLeveler();
// weak TV computers drop the heaviest effects (blur over videos and the like)
if (!isPhone) installLiteMode();

const root = ReactDOM.createRoot(document.getElementById('root'));
// «Перевірка знань»: its own pages, nothing of the game (no media, no sounds)
const route = window.location.pathname.replace(/\/+$/, '');
if (route === '/test' || route === '/teacher') {
  document.title = 'Перевірка знань';
  document.body.style.background = '#f3f5f9';
  document.documentElement.classList.add('exam-page'); // ordinary vertical scroll (exam.css)
  root.render(<React.StrictMode>{route === '/test' ? <ExamStudent /> : <ExamTeacher />}</React.StrictMode>);
} else {
  root.render(
    <React.StrictMode>
      {/* the TV downloads all media up front so nothing stalls mid-game; phones start right away */}
      {isPhone ? <App /> : <><MediaPreloader><App /></MediaPreloader><SoundUnlock /></>}
    </React.StrictMode>
  );
}

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
