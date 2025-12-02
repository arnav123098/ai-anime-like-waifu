import { useState, useEffect, useRef } from 'react'
import VRMMODEL from './VRMModel'
import Recorder from 'recorder-js'
import '@fortawesome/fontawesome-free/css/all.min.css';

import './app.css'

const url = 'http://localhost:6969';

function App() {
  const [userMessage, setUserMessage] = useState('');
  const [sessionId, setSessionId] = useState('')
  const [audioClip, setAudioClip] = useState(null);
  const [isAudioDone, setIsAudioDone] = useState(true);
  const [animation, setAnimation] = useState('idle');
  const [enSub, setEnSub] = useState('');
  const [recording, setRecording] = useState(false);
  const inactivityTimer = useRef(null);
  const idleInterval = useRef(null);

  function resetInactivityTimer() {
    if (inactivityTimer.current) {
      clearTimeout(inactivityTimer.current);
    }

    if (idleInterval.current) {
      clearInterval(idleInterval.current);
      idleInterval.current = null;
    }

    inactivityTimer.current = setTimeout(() => {
      idleInterval.current = setInterval(() => 
        setAnimation(prev => prev === 'idle' ? 'batterOnDeck' : 'idle'), 30000
      )
    }, 30000);
  }

  // start inactivity timer
  useEffect(() => {
    resetInactivityTimer();
  }, []);

  function hexToUint8Array(hex) {
    if (!hex) return null;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  }

  const fetchAudio = async () => {
    try {
      const data = await fetch(url + '/chat/fetch' + `?sessionId=${sessionId}`)
      .then(res => res.json())
      .catch(err => console.log(err));
      
      const {has_more, audio, en_sub} = data

      if (!has_more) {
        setAudioClip(null);
        setIsAudioDone(true);
        setSessionId('');
        console.log('session done');
        return;
      }

      setIsAudioDone(false);

      if (audio) {
        setAudioClip(audio);
        setEnSub(en_sub);
        console.log('audio clip received');
      } else {
        setTimeout(fetchAudio, 500);
        console.log('audio clip not receieved');
      }
    } catch (err) {
      console.error(err);
      setIsAudioDone(true);
      setAudioClip(null);
    }
  }

  const handleSend = async () => {
    if (userMessage.trim() != '' && sessionId == '') {
      resetInactivityTimer();
      try {
        const res = await fetch(url + '/send-message', {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            "message": userMessage
          })
        });

        if (!res.ok) {
          console.log('failure');
          setSessionId('');
          return;
        }

        const data = await res.json();
        setSessionId(data.sessionId);
        setIsAudioDone(false);

      } catch (err) {
        console.error(err);
      }
    } 
  }

  const recorder = useRef(null);
  const audioContext = useRef(new (window.AudioContext || window.webkitAudioContext)());

  const startRecording = async () => {
    setRecording(true);
    await audioContext.current.resume();
    const stream = await navigator.mediaDevices.getUserMedia({audio:true});
    recorder.current = new Recorder(audioContext.current)
    await recorder.current.init(stream);
    recorder.current.start();
    console.log('recording...')
  }

  const stopRecording = async () => {
    setRecording(false);
    if (!recorder.current) return;
    const { blob } = await recorder.current.stop();
    console.log('Blob size:', blob.size);
    if (!blob) {
      console.error("Recorder did not produce a Blob");
      return;
    }
    handleSendAudio(blob);
  }

  const handleSendAudio = async (blob) => {
    if (sessionId != '') return;
    resetInactivityTimer();
    const formData = new FormData();
    formData.append('audio', blob, 'input.wav');
    const res = await fetch(url + '/send-message', {
      method: "POST",
      body: formData
    });

    const data = await res.json();
    setSessionId(data.sessionId);
    setIsAudioDone(false);
    console.log(data.sessionId);
  }

  // record audio with shortcut
  useEffect(() => {
    function handleKey(e) {
      if (e.altKey && e.key.toLowerCase() === "v") {
        if (!recording) {
          console.log("Start recording");
          startRecording();
        } else {
          console.log("Stop recording");
          stopRecording();
        }
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [recording]);

  useEffect(() => {
    function handleEnter({key}) {
      if (key == 'Enter') {
        handleSend();
      }
    }
    window.addEventListener('keydown', handleEnter);
    return () => window.removeEventListener('keydown', handleEnter);
  });

  // play voice
  useEffect(() => {
    if (!isAudioDone && sessionId) {
      resetInactivityTimer();
      console.log(sessionId);
      if (!audioClip) {
        fetchAudio();
      } else {
        const audioBytes = hexToUint8Array(audioClip);
        const blob = new Blob([audioBytes], { type: 'audio/wav' });
        const audioUrl = URL.createObjectURL(blob);
        console.log('now playing...');
        const audioEl = new Audio(audioUrl);
        audioEl.onended = () => {
          setAudioClip(null);
          setAnimation('idle');
          resetInactivityTimer();
          URL.revokeObjectURL(audioUrl);
        };
        setAnimation('talking');
        audioEl.play().catch(err => console.error("Audio play failed", err));
      }
    }
  }, [audioClip, sessionId, isAudioDone]);

  return (
    <>
      <div id="message-box">
        <textarea type="text" id="text-box" onChange={({target}) => setUserMessage(target.value)} value={userMessage} />
        <button id="send" disabled={sessionId != ''} onClick={handleSend}><i className="fa-chisel fa-regular fa-paper-plane"></i></button>
        <h2>|</h2>
        <button className={recording ? 'mic-active mic-btn' : 'mic-btn'} onClick={recording ? stopRecording : startRecording}>{recording ? <i className="fa-solid fa-stop"></i> : <i className="fa-solid fa-microphone"></i> }</button>
      </div>
      <VRMMODEL animation={animation} mouthMovement={audioClip ? true : false}/>
      {audioClip &&
        <h3 id='subtitles'>{enSub}</h3>
      }
    </>
  )
}

export default App
