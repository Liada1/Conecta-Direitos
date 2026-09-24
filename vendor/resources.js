// Faz o support.js (dc-runtime, gerado — não editar) carregar React/ReactDOM
// daqui do próprio site em vez do unpkg.com. O runtime consulta
// window.__resources[url] antes de baixar de um CDN (ver cdnScriptFor() no
// support.js). As chaves precisam ser EXATAMENTE as URLs fixadas lá dentro;
// se um dia o support.js mudar de versão do React, atualize as duas pontas.
// Os arquivos em vendor/react/ são byte a byte os mesmos do unpkg (conferido
// contra os hashes SRI que o próprio support.js traz).
window.__resources = {
  "https://unpkg.com/react@18.3.1/umd/react.production.min.js": "./vendor/react/react.production.min.js",
  "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js": "./vendor/react/react-dom.production.min.js"
};
