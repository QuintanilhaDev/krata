const split = (s: string) => s.trim().split(/\s+/)
export const EMOJI_GROUPS: { id: string; label: string; icon: string; items: string[] }[] = [
  { id: 'smileys', label: 'Rostos', icon: '😀', items: split('😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖') },
  { id: 'gestures', label: 'Gestos', icon: '👍', items: split('👍 👎 👏 🙌 🙏 🤝 👊 ✊ 🤛 🤜 🤞 ✌️ 🤟 🤘 👌 🤌 🤏 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤙 💪 🫶 🫡 🫠 🫣 👀 🧠 🫂') },
  { id: 'hearts', label: 'Corações', icon: '❤️', items: split('❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 💯 💢 💥 💫 💦 💨 🔥 ✨ ⭐ 🌟 ⚡ 🎉 🎊') },
  { id: 'nature', label: 'Natureza', icon: '🌿', items: split('🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🦆 🦉 🦇 🐺 🐴 🦄 🐝 🦋 🐢 🐍 🐙 🐬 🐳 🦈 🌵 🌲 🌴 🌿 🍀 🍃 🌸 🌹 🌻 🌙 ☀️ ⛅ 🌧️ ❄️ 🌈 🌊') },
  { id: 'food', label: 'Comida', icon: '🍕', items: split('🍎 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥥 🥑 🌽 🥕 🍞 🧀 🍳 🥓 🍔 🍟 🍕 🌭 🌮 🌯 🍝 🍜 🍣 🍤 🍚 🍰 🎂 🍪 🍫 🍬 🍩 🍿 ☕ 🍵 🥤 🧋 🍺 🍻 🥂 🍷') },
  { id: 'activity', label: 'Atividades', icon: '🎮', items: split('⚽ 🏀 🏈 ⚾ 🎾 🏐 🎱 🏓 🥊 🏆 🥇 🥈 🥉 🎮 🕹️ 🎲 🧩 🎯 🎳 🎸 🎹 🥁 🎤 🎧 🎬 🎨 📷 🎥 📺 💻 ⌨️ 🖱️ 📱 🚗 ✈️ 🚀 🏠 💡 💰 💎 🎁 📌 📎 ✏️ 📚 🔒 🔑 🔔 ⏰') },
  { id: 'symbols', label: 'Símbolos', icon: '✅', items: split('✅ ❌ ❓ ❗ ⚠️ 🚫 💤 ♻️ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ ⬆️ ⬇️ ⬅️ ➡️ 🔄 ➕ ➖ ✖️ 🆗 🆒 🆕 🔝 🇧🇷') },
]
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥']
export const recentEmoji = (): string[] => {
  try { return JSON.parse(localStorage.getItem('krata-recent-emoji') || '[]') } catch { return [] }
}
