# База питань вікторини

## Структура

- **round1.json … round10.json** — масиви питань для кожного раунду. У кожному раунді є питання трьох рівнів: `easy`, `medium`, `hard`. Гра випадково обирає одне питання з масиву раунду.
- **audio/round1/ … audio/round10/** — папки з озвучкою для кожного раунду.

## Куди класти озвучку

Для кожного раунду (1–10) відкрийте відповідну папку:

```
client/public/assets/questions/audio/round1/
client/public/assets/questions/audio/round2/
...
client/public/assets/questions/audio/round10/
```

У кожну папку **roundN** покладіть **15 MP3-файлів** (по 5 на кожен рівень):

| Файли | Призначення |
|-------|--------------|
| `easy_1.mp3` … `easy_5.mp3` | Озвучка легких питань |
| `medium_1.mp3` … `medium_5.mp3` | Озвучка середніх питань |
| `hard_1.mp3` … `hard_5.mp3` | Озвучка важких питань |

Приклад для раунду 1:
- `client/public/assets/questions/audio/round1/easy.mp3`
- `client/public/assets/questions/audio/round1/medium.mp3`
- `client/public/assets/questions/audio/round1/hard.mp3`

Якщо ви зміните ім’я файлу в JSON (наприклад на `question_1.mp3`), той самий файл має лежати в папці цього раунду з такою назвою.

## Як додавати нові питання

1. Відкрийте потрібний файл, наприклад **round3.json**.
2. Додайте новий об’єкт у масив (скопіюйте існуючий і змініть поля):

```json
{
  "id": "r3_medium_2",
  "difficulty": "medium",
  "text": "Текст нового питання?",
  "options": ["Варіант A", "Варіант B", "Варіант C", "Варіант D"],
  "correctIndex": 0,
  "audioFile": "medium_2.mp3"
}
```

3. Озвучку для цього питання покладіть у ту саму папку раунду:  
   `audio/round3/medium_2.mp3`

Поле **correctIndex** — індекс правильної відповіді (0, 1, 2 або 3).

## Формат одного питання в JSON

| Поле          | Опис |
|---------------|------|
| `id`          | Унікальний ідентифікатор (наприклад `r1_easy`) |
| `difficulty`  | `"easy"`, `"medium"` або `"hard"` |
| `text`        | Текст питання (озвучка + друк на екрані) |
| `options`     | Масив з 4 варіантів відповіді |
| `correctIndex`| Індекс правильної відповіді (0–3) |
| `audioFile`   | Ім’я MP3-файлу в папці цього раунду |
