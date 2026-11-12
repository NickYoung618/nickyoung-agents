document.querySelector("form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    let r = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: e.target.password.value }),
    });
    let d = await r.json();
    if (!r.ok) throw Error(d.error);
    location.href = "/";
  } catch (e) {
    document.querySelector("#error").textContent = e.message;
  }
};
