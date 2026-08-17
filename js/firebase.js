/* Inicialização única do Firebase e re-export das APIs usadas pelo app.
 * Centralizar aqui evita 15 arquivos importando URLs de CDN diferentes.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  sendPasswordResetEmail, createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  deleteDoc, query, where, orderBy, limit, startAfter, onSnapshot,
  serverTimestamp, runTransaction, writeBatch, getCountFromServer, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { FIREBASE_CONFIG } from "./config.js";

export const app  = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
export const db   = getFirestore(app);
export const storage = getStorage(app);

export {
  signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail,
  createUserWithEmailAndPassword,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, startAfter, onSnapshot, serverTimestamp,
  runTransaction, writeBatch, getCountFromServer, Timestamp,
  storageRef, uploadBytes, getDownloadURL, deleteObject
};
