# 0003: Voice and handwriting input, opt-in per clinic

Status: accepted · 14 October 2026

## Requirement

Patient history entries must support voice-to-text and handwriting-to-text, and both must be available.

## Decision

**Voice dictation.** The browser's built-in speech recognition fills the text box while the doctor speaks. Languages offered: English and Urdu. The transcript is editable before saving. No audio is stored or sent to our server.

**Handwriting.** The doctor photographs a handwritten note or writes on a touch screen. The image goes to the server, which sends it to Claude for transcription. The result is shown for review and saved only when the doctor accepts it. The original image is kept with the visit.

**Optional tidy-up.** A dictated or transcribed note can be reorganised into the visit fields, such as complaint, history, examination, diagnosis and plan. The doctor reviews the result.

**Opt-in.** AI features are off for every clinic until the owner turns them on in settings. Handwriting and tidy-up also need an API key on the server.

## Trade-offs the clinic owner should know

- Browser speech recognition in Chrome sends audio to the browser vendor's servers. It is not private, and it needs an internet connection.
- Handwriting images and note text go to an AI provider. This is health information, so the settings screen explains this before it can be switched on.
- Transcription can be wrong, especially for doctors' handwriting, drug names and Urdu script. Nothing is saved without review, and results are labelled as AI-assisted.
- Accuracy for Urdu handwriting and Urdu speech has not been measured here. Measure it with real notes from pilot clinics before relying on it.

## Alternatives considered

- Server-side speech-to-text from another vendor. Rejected for now: a second AI vendor, more cost and privacy surface. Revisit if browser dictation proves unreliable on clinic devices.
- Automatic saving of AI output. Rejected: unsafe for medical records.

## Consequences

- A failed or slow AI call never blocks saving a visit. The user can type instead.
- Each AI use is recorded in the audit log, without storing the note text there.
