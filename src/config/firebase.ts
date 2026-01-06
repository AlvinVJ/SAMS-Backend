import admin, { type ServiceAccount } from "firebase-admin";
import serviceAccount from "../firebase/serviceAccountKeys.json" with { type: "json" };

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as ServiceAccount),
  });
}

export default admin;
