// This apiKey is safe to be public in client-side code — Firebase's real
// security boundary is Firestore security rules, not hiding this value.
// Still fine to move to a .env + webpack.DefinePlugin later if you'd rather
// not commit it, e.g. to keep this project unidentifiable in a public repo.
export const firebaseConfig = {
  apiKey: 'AIzaSyCD68cz3DQpY4aEnyeGzA_iaRz6puem5Qc',
  authDomain: 'area-control-ff713.firebaseapp.com',
  projectId: 'area-control-ff713',
  storageBucket: 'area-control-ff713.firebasestorage.app',
  messagingSenderId: '52429745558',
  appId: '1:52429745558:web:b74ef79732e6901b8dc1b7',
};
