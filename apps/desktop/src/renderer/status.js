window.dshDesktop?.onStatus((message) => {
  const element = document.getElementById('status')
  if (element) element.textContent = message
})
