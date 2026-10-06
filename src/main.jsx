import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App (2).jsx";

class StartupErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    try {
      console.error("Rexa startup/runtime error", error, info);
    } catch {}
  }
  render() {
    if (this.state.error) {
      const message = this.state.error?.message || String(this.state.error);
      return React.createElement(
        "div",
        { dir: "rtl", style: { minHeight: "100vh", padding: "32px 20px", boxSizing: "border-box", fontFamily: "Tahoma, sans-serif", background: "#F1EFF4", color: "#241a30" } },
        React.createElement("div", { style: { maxWidth: 480, margin: "0 auto", background: "#fff", borderRadius: 18, padding: 20, boxShadow: "0 8px 30px rgba(0,0,0,.10)" } },
          React.createElement("h2", { style: { marginTop: 0 } }, "خطای اجرای Rexa"),
          React.createElement("p", null, "برنامه نتوانست صفحه اصلی را اجرا کند. جزئیات خطا:"),
          React.createElement("pre", { style: { whiteSpace: "pre-wrap", direction: "ltr", textAlign: "left", fontSize: 12, background: "#f7f5fa", padding: 12, borderRadius: 10, overflowX: "auto" } }, message),
          React.createElement("button", { onClick: () => window.location.reload(), style: { width: "100%", border: 0, borderRadius: 10, padding: "12px 14px", background: "#3E1461", color: "#fff", fontWeight: 700 } }, "تلاش دوباره")
        )
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <StartupErrorBoundary>
    <React.StrictMode>
      <App />
    </React.StrictMode>
  </StartupErrorBoundary>
);
