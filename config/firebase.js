import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin SDK
let firebaseAdmin = null;
let db = null;
let FieldValue = null;

try {
  let serviceAccount;
  
  // Try environment variable first
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } 
  // Try file
  else {
    const filePath = path.join(__dirname, '../firebase-service-account.json');
    
    // Check if file exists
    const fs = await import('fs');
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    const fileContent = fs.readFileSync(filePath, 'utf8');
    
    // Validate file is not empty
    if (!fileContent || fileContent.trim() === '') {
      throw new Error('Service account file is empty');
    }
    
    serviceAccount = JSON.parse(fileContent);
  }
  
  // Initialize Firebase
  firebaseAdmin = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  
  db = firebaseAdmin.firestore();
  FieldValue = admin.firestore.FieldValue;
  
} catch (error) {
  console.error('❌ Firebase Admin initialization error:', error.message);
  console.error('💡 Tip: Make sure your firebase-service-account.json is valid JSON');
  console.error('💡 Or set FIREBASE_SERVICE_ACCOUNT environment variable');
  console.error('⚠️ Chat features requiring Firebase Admin will not work');
  
  // Create dummy FieldValue to prevent crashes in other files
  FieldValue = {
    serverTimestamp: () => new Date(),
    arrayUnion: (...args) => args,
    arrayRemove: (...args) => args
  };
}

export { db, FieldValue };
export default firebaseAdmin;