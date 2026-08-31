let deferredInstallPrompt = null;

function isIOSDevice(){
  const ua = navigator.userAgent || '';
  const classicIOS = /iPad|iPhone|iPod/i.test(ua);
  const iPadDesktopMode = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return classicIOS || iPadDesktopMode;
}

function isAppInstalledMode(){
  const standaloneDisplay = window.matchMedia?.('(display-mode: standalone)').matches === true;
  const iosStandalone = window.navigator.standalone === true;
  const androidTwa = document.referrer?.startsWith('android-app://') === true;
  return standaloneDisplay || iosStandalone || androidTwa;
}

function installButton(){
  return document.getElementById('installApp');
}

function updateInstallButtonVisibility(){
  const button = installButton();
  if(!button) return;

  // Quando o sistema está sendo executado como aplicativo instalado,
  // não faz sentido oferecer a instalação novamente.
  if(isAppInstalledMode()){
    button.classList.add('hidden');
    return;
  }

  // iPhone/iPad não expõem beforeinstallprompt. Neles mantemos o botão
  // visível para ensinar a instalação pela Tela de Início.
  if(isIOSDevice()){
    button.classList.remove('hidden');
    return;
  }

  // Android/Chrome/Edge só mostram o botão quando o navegador realmente
  // disponibiliza o prompt nativo de instalação.
  button.classList.toggle('hidden', !deferredInstallPrompt);
}

function showIOSInstallInstructions(){
  const message = [
    'Para instalar o Na Régua no iPhone ou iPad:',
    '',
    '1. Toque no botão Compartilhar do navegador (quadrado com a seta para cima).',
    '2. Escolha “Adicionar à Tela de Início”.',
    '3. Se aparecer a opção, deixe “Abrir como App da Web” ativada.',
    '4. Toque em “Adicionar”.',
    '',
    'Depois abra o Na Régua pelo ícone criado na Tela de Início. Quando estiver rodando como aplicativo instalado, este botão será escondido automaticamente.',
    '',
    'Se “Adicionar à Tela de Início” não aparecer no navegador atual, abra esta página no Safari e repita os passos.'
  ].join('\n');

  if(typeof showAppMessage === 'function'){
    showAppMessage(message, 'info', {title:'Instalar no iPhone/iPad', okText:'Entendi'});
  }else{
    alert(message);
  }
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallButtonVisibility();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  updateInstallButtonVisibility();
});

async function installApp(){
  if(isAppInstalledMode()){
    updateInstallButtonVisibility();
    return;
  }

  if(isIOSDevice()){
    showIOSInstallInstructions();
    return;
  }

  // Android e PC usam somente o instalador nativo do navegador.
  // Se o navegador ainda não liberou beforeinstallprompt, o botão fica oculto e
  // não mostramos as instruções específicas do iPhone por engano.
  if(!deferredInstallPrompt){
    updateInstallButtonVisibility();
    return;
  }

  const promptEvent = deferredInstallPrompt;
  promptEvent.prompt();
  const choice = await promptEvent.userChoice;
  deferredInstallPrompt = null;

  // Se o usuário aceitou, o evento appinstalled também reforçará a ocultação.
  // Se recusou, aguardamos um novo beforeinstallprompt antes de mostrar novamente.
  updateInstallButtonVisibility();
  return choice;
}

// Atualiza ao entrar/voltar para a página. Isso cobre especialmente o iPhone,
// quando o usuário instala pela Tela de Início e depois abre o PWA.
window.addEventListener('pageshow', updateInstallButtonVisibility);
document.addEventListener('visibilitychange', () => {
  if(!document.hidden) updateInstallButtonVisibility();
});

try{
  const displayModeQuery = window.matchMedia?.('(display-mode: standalone)');
  if(displayModeQuery?.addEventListener) displayModeQuery.addEventListener('change', updateInstallButtonVisibility);
  else if(displayModeQuery?.addListener) displayModeQuery.addListener(updateInstallButtonVisibility);
}catch(_){/* navegador sem suporte completo a matchMedia */}

updateInstallButtonVisibility();

if('serviceWorker' in navigator){
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(console.error));
}
