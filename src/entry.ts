import "./boot.css";

const loading = document.getElementById("boot-status")!;
const load =
  new URLSearchParams(location.search).get("chapter") === "forest"
    ? import("./chapter/page")
    : import("./main");
void load
  .then(() => loading.remove())
  .catch(() => {
    loading.textContent = "Не удалось загрузить игру. ";
    const retry = document.createElement("button");
    retry.textContent = "Повторить загрузку";
    retry.onclick = () => location.reload();
    loading.append(retry);
  });
