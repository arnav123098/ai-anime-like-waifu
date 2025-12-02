import subprocess
from ollama import chat
from time import time
import requests
from flask import Flask, jsonify, request
from flask_cors import CORS
import uuid
from queue import Queue
from threading import Thread
import os
import shutil
from setup import USER_NAME, OLLAMA_MODEL, SPEAKER_ID, VOICEVOX_PORT, VOICE_PRESET

SYSTEM_PROMPT = (
    f"You are an intelligent adn helpful friend with a slightly tsundere persona."
    f"Your user's name is {USER_NAME} and he thinks you're his waifu."
    "STRICT RESPONSE RULES: Respond ONLY in Japanese."
    "After every complete Japanese sentence, you MUST provide its English translation "
    "immediately in the format <<english translation>>, without line breaks between the Japanese sentence "
    "and the opening parenthesis. EXAMPLE OF RESPONSE SENTENCE: コードを書くのは楽しいです。<<Writing code is fun.>>"
)

def sentenceCompletionCheck(text):
  idx = text.find('>>')
  return (True, idx) if idx != -1 else (False, 0)

def sentenceCrop(text, en_last_idx):
  # llm_output: 'おはようございます！ <<Good morning!>>'
  # converted to -
  # jap_sentence, en_subtitles = 'おはようございます！', 'Good morning!'
  jap_last_idx = text.find('<<')
  jap_sentence = text[:jap_last_idx]

  en_sentence = text[jap_last_idx+2:en_last_idx]

  isDone = False if len(jap_sentence) < 15 else True

  return jap_sentence, en_sentence, isDone

def runTTS(sentence_number, jap_chunk, en_sub, sessionId):
  audio_t0 = time()
  OUTPUT_PATH = f'{sessionId}/output-{sentence_number}-{sessionId}'

  base = f"http://localhost:{VOICEVOX_PORT}"
  query = requests.post(
      f"{base}/audio_query",
      params={"text": jap_chunk, "speaker": SPEAKER_ID},
      timeout=10,
  ).json()  

  for k, v in VOICE_PRESET.items():
      query[k] = v

  wav = requests.post(
      f"{base}/synthesis",
      params={"speaker": SPEAKER_ID},
      json=query,
      timeout=30,
  )

  with open(OUTPUT_PATH + '.wav', "wb") as f:
      f.write(wav.content)
  with open(OUTPUT_PATH + '.txt', "w") as tf:
      tf.write('\n'.join(en_sub))

  print(f'\n\n{sentence_number=}\naudio_time={time()-audio_t0:.2f}s\n{jap_chunk=}')

  return OUTPUT_PATH

app = Flask(__name__)
CORS(app)

sessions = {}

@app.route('/send-message', methods=['POST'])
def send_message():
  sessionId = str(uuid.uuid4())
  os.makedirs(sessionId, exist_ok=True)
  q = Queue()
  
  # audio input handler
  if request.content_type.startswith("multipart/form-data"):
    audio = request.files['audio']
    INPUT_PATH = sessionId + '/input.wav'
    audio.save(INPUT_PATH)
    
    WHISPER_COMMAND = [
            "./whisper/whisper-cli.exe",
            "-m", "./whisper-models/ggml-tiny.bin",
            "-f", INPUT_PATH,
            "-otxt",
            "-t", "8",
            "--language", "English"
          ]
    subprocess.run(WHISPER_COMMAND)

    if not os.path.exists(INPUT_PATH + '.txt'):
      return jsonify({"error": "Whisper failed to transcribe audio"}), 500
    
    with open(INPUT_PATH + '.txt', 'r', encoding='utf8') as f:
      message = f.read()
      
  else: # text input handler
    data = request.get_json()
    message = data['message']

  sessions[sessionId] = {
     'queue': q,
     'done': False
  }

  Thread(target=pipeline, args=(message, sessionId), daemon=True).start()

  return jsonify({
    "sessionId": sessionId,
  }), 200

@app.route('/chat/fetch', methods=['GET'])
def fetch_voice():
  sessionId = request.args.get('sessionId')

  if sessionId not in sessions:
    return jsonify({"error": "invalid session"}), 400
  
  q = sessions[sessionId]['queue']
  done = sessions[sessionId]['done']

  if not q.empty():
    path = q.get()
    with open(path + '.wav', "rb") as f:
        audio_bytes = f.read()
    with open(path + '.txt', 'r') as tf:
        subtitles = tf.read()
    response = {
        "has_more": True,
        "audio": audio_bytes.hex(),
        "en_sub": subtitles
    }

    return jsonify(response), 200

  # delete folder and session
  if done:
    response = {
        "has_more": False,
        "audio": None,
        "en_sub": ''
    }

    if os.path.exists(sessionId):
        shutil.rmtree(sessionId)
        print(f"Deleted session folder: {sessionId}")
    del sessions[sessionId]

    return jsonify(response), 200

  return jsonify({
    "has_more": True,
    "audio": None,
    "en_sub": ''
  }), 200

def pipeline(message, sessionId):
  t0 = time()
  q = sessions[sessionId]['queue']

  stream = chat(
    model=OLLAMA_MODEL,
    messages=[
      {'role': 'system', 'content': SYSTEM_PROMPT},
      {'role': 'user', 'content': message}
    ],
    stream=True,
  )

  isFirstChunk = True
  sentence_number = last_idx = 0
  LLM_OUTPUT = jap_chunk = ''
  en_subtitles_chunk = []

  for chunk in stream:
    content = chunk['message']['content']

    if isFirstChunk:
      llm_output_start_delay = time() - t0
      print(f'{llm_output_start_delay=}')
      isFirstChunk = False

    LLM_OUTPUT += content
    # print('c: ', LLM_OUTPUT)
    
    isSentence, next_idx = sentenceCompletionCheck(LLM_OUTPUT[last_idx:])
    if isSentence:
      jap_sentence, en_subtitles, isDone = sentenceCrop(LLM_OUTPUT[last_idx:last_idx+next_idx+1], next_idx)
      jap_chunk += jap_sentence
      en_subtitles_chunk.append(en_subtitles) # display them later one by one
      last_idx += next_idx+1

      if isDone:
        path = runTTS(sentence_number, jap_chunk, en_subtitles_chunk, sessionId)
        q.put(path)
        sentence_number += 1
        jap_chunk = ''
        print('en_sub=', ' '.join(en_subtitles_chunk), sep='')
        en_subtitles_chunk = []
  print('done')
  print(f'{LLM_OUTPUT=}')
  sessions[sessionId]['done'] = True

# if __name__ == '__main__':
#   app.run(debug=True, port=6969)
