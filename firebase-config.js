import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBukB9lMl9tRZR5pwPMJtllKw8i6PVN9U4",
  authDomain: "el-camino-al-titulo.firebaseapp.com",
  databaseURL: "https://el-camino-al-titulo-default-rtdb.firebaseio.com",
  projectId: "el-camino-al-titulo",
  storageBucket: "el-camino-al-titulo.firebasestorage.app",
  messagingSenderId: "341317878088",
  appId: "1:341317878088:web:a89c809e302faf4161f37d"
};

export const firebaseApp = initializeApp(firebaseConfig);
export const database = getDatabase(firebaseApp);
