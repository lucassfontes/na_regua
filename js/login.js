document.addEventListener('DOMContentLoaded',async()=>{
  const existing=await currentProfile(); if(existing){location.replace(existing.role==='super_admin'?'super-admin.html':existing.role==='owner'?'admin.html':'barber.html');return}
  $('#loginForm').addEventListener('submit',async e=>{e.preventDefault();const b=$('#loginBtn');b.disabled=true;const email=$('#email').value.trim(),password=$('#password').value;const {error}=await sb.auth.signInWithPassword({email,password});if(error){toast(error.message,'error');b.disabled=false;return}const p=await currentProfile();if(!p){toast('Usuário sem perfil ativo.','error');await sb.auth.signOut();b.disabled=false;return}location.href=p.role==='super_admin'?'super-admin.html':p.role==='owner'?'admin.html':'barber.html'});
});
