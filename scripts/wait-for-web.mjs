// 在 Docker Compose 的 verify 服务中等待 web 就绪；本地运行（未设 VERIFY_TARGET）时直接通过。
const target = process.env.VERIFY_TARGET;

if (!target) {
  process.exit(0);
}

const deadline = Date.now() + 60_000;

async function ready() {
  try {
    const res = await fetch(target, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

while (Date.now() < deadline) {
  if (await ready()) {
    console.log(`web 服务已就绪: ${target}`);
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

console.error(`等待 ${target} 超时`);
process.exit(1);
