# HomeLab HUB

React/Vite-Webseite mit Login, Berliner Uhr, Google-Suche und einem Webseiten-Hub.

## Speicherung der Webseiten

- Ohne Firebase: lokale Speicherung im Browser (`localStorage`).
- Mit Firebase: Cloud-Speicherung in Firestore und dadurch auf anderen Geräten sichtbar.

## Firebase aktivieren (für geräteübergreifende Daten)

1. Firebase-Projekt erstellen und **Firestore + Authentication (E-Mail/Passwort)** aktivieren.
2. Sichere Firestore-Regeln verwenden (Datei `firestore.rules` im Projekt):

```txt
rules_version = '2';
service cloud.firestore {
	match /databases/{database}/documents {
		match /users/{userId}/hubs/{hubId} {
			allow read, write: if request.auth != null && request.auth.uid == userId;
		}

		match /{document=**} {
			allow read, write: if false;
		}
	}
}
```

3. Regeln deployen (Firebase CLI):

```bash
npm i -g firebase-tools
firebase login
firebase use <dein-projekt-id>
firebase deploy --only firestore:rules
```

4. Datei `.env` im Projekt anlegen (anhand von `.env.example`) und Werte eintragen:

```txt
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

5. Projekt starten:

```bash
npm install
npm run dev
```

Wenn Firebase korrekt konfiguriert ist, meldest du dich im Login mit deiner Firebase-E-Mail und deinem Firebase-Passwort an. Danach zeigt die App "Cloud-Sync aktiv" an und neue Webseiten sind auf allen Geräten sichtbar, auf denen derselbe Account genutzt wird.
# Homelab-Hub
