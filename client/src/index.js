import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { installAudioLeveler } from './game/audioLeveler';
import { installLiteMode } from './game/liteMode';
import MediaPreloader from './components/MediaPreloader';
import SoundUnlock from './components/SoundUnlock';

// the TV: one loudness for every sound and video (phones play little and are left alone)
const isPhone = window.innerWidth <= 768 || /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent);
if (!isPhone) installAudioLeveler();
// weak TV computers drop the heaviest effects (blur over videos and the like)
if (!isPhone) installLiteMode();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    {/* the TV downloads all media up front so nothing stalls mid-game; phones start right away */}
    {isPhone ? <App /> : <><MediaPreloader><App /></MediaPreloader><SoundUnlock /></>}
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
