import { RIN_RELEASE_ID } from './release.js';
import { fetchWithTimeout, removeStoredPin } from './http_client.js';
const form=document.getElementById('loginForm');
const input=document.getElementById('pinInput');
const button=form?.querySelector('button[type="submit"]');
const errorBox=document.getElementById('loginError');
function showError(message){if(errorBox){errorBox.textContent=message;errorBox.hidden=!message;}}
const reason=new URLSearchParams(window.location.search).get('reason');
if(reason==='invalid_pin'||reason==='session_expired')showError('Сессия завершилась. Введи PIN для входа.');
if(reason==='auth_unavailable')showError('Сервис входа временно недоступен. Повтори позже.');
form?.addEventListener('submit',async event=>{
  event.preventDefault();
  const pin=String(input?.value||'').trim();if(!pin)return;
  showError('');if(button)button.disabled=true;if(input)input.disabled=true;
  try{
    const res=await fetchWithTimeout('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin}),cache:'no-store'},10000);
    if(!res.ok){showError(res.status===401?'Неверный PIN.':res.status===429?'Слишком много попыток. Повтори позже.':'Сервис входа временно недоступен.');return;}
    removeStoredPin();
    window.location.replace(`/index.html?v=${encodeURIComponent(RIN_RELEASE_ID)}`);
  }catch{showError('Не удалось проверить PIN. Проверь подключение.');}
  finally{if(button)button.disabled=false;if(input)input.disabled=false;input?.focus();}
});
document.documentElement.classList.add('login-ready');
