/* Autenticação, sessão e controle de acesso na camada de UI.
 * O bloqueio real está em firestore.rules — isto aqui só evita mostrar o que não interessa.
 */
import {
  auth, db, doc, getDoc, getDocs, setDoc, updateDoc, collection, query, where,
  signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail,
  serverTimestamp
} from "./firebase.js";
import { podeFazer, PERFIL_LABEL } from "./config.js";

export const sessao = { uid: null, email: null, usuario: null, pronta: false };

export function pode(permissao) {
  if (!sessao.usuario) return false;
  return podeFazer(sessao.usuario.perfil, permissao);
}

export function ehTecnico()  { return sessao.usuario?.perfil === "TECNICO"; }
export function ehAdmin()    { return sessao.usuario?.perfil === "ADMINISTRADOR"; }
export function perfilLabel(){ return PERFIL_LABEL[sessao.usuario?.perfil] || "—"; }

/** Carrega o documento de usuário. O id do doc é o UID do Firebase Auth. */
async function carregarUsuario(uid, email) {
  let s = await getDoc(doc(db, "usuarios", uid));
  if (!s.exists()) {
    /* O administrador pode ter cadastrado a pessoa pelo e-mail, antes do primeiro login.
       Nesse caso o documento existe com outro ID e precisa ser migrado para o UID.
       A consulta por e-mail é negada pelas regras para quem ainda não tem cadastro —
       isso é o comportamento correto e NÃO pode derrubar o login. */
    try {
      const q = await getDocs(query(collection(db, "usuarios"), where("email", "==", email)));
      if (!q.empty) {
        const antigo = q.docs[0];
        await setDoc(doc(db, "usuarios", uid), { ...antigo.data(), migrado_de: antigo.id });
        s = await getDoc(doc(db, "usuarios", uid));
      }
    } catch (e) {
      console.info("[auth] sem cadastro vinculado a este acesso.");
    }
  }
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

export function iniciarAuth(aoMudar) {
  onAuthStateChanged(auth, async user => {
    if (!user) {
      Object.assign(sessao, { uid: null, email: null, usuario: null, pronta: true });
      return aoMudar(null);
    }
    const u = await carregarUsuario(user.uid, user.email);
    if (!u) {
      Object.assign(sessao, { uid: user.uid, email: user.email, usuario: null, pronta: true });
      return aoMudar({ erro: "SEM_CADASTRO", email: user.email, uid: user.uid });
    }
    if (u.ativo === false) {
      await signOut(auth);
      return aoMudar({ erro: "INATIVO" });
    }
    Object.assign(sessao, { uid: user.uid, email: user.email, usuario: u, pronta: true });
    updateDoc(doc(db, "usuarios", user.uid), { ultimo_acesso: serverTimestamp() }).catch(() => {});
    aoMudar(u);
  });
}

export async function entrar(email, senha) {
  await signInWithEmailAndPassword(auth, email.trim(), senha);
}
export async function sair() { await signOut(auth); }
export async function recuperarSenha(email) { await sendPasswordResetEmail(auth, email.trim()); }

export const MSG_AUTH = {
  "auth/invalid-credential": "E-mail ou senha incorretos.",
  "auth/invalid-email": "E-mail inválido.",
  "auth/user-disabled": "Usuário desativado.",
  "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos.",
  "auth/network-request-failed": "Sem conexão com a internet."
};
