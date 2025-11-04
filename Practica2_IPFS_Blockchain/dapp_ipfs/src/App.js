import React, { useEffect, useState } from "react";
import "./App.css";
import { create } from "kubo-rpc-client";
import { ethers } from "ethers";
import { Buffer } from "buffer";
import logo from "./ethereumLogo.png";
import { addresses, abis } from "./contracts";

const provider = new ethers.providers.Web3Provider(window.ethereum);
const contract = new ethers.Contract(addresses.crowdfunding, abis.crowdfunding, provider);

function App() {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [cid, setCid] = useState("");

  // Conectar a MetaMask al cargar
  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.request({ method: "eth_requestAccounts" });
    }
  }, []);

  const handleFileChange = (e) => {
    const data = e.target.files[0];
    const reader = new window.FileReader();
    reader.readAsArrayBuffer(data);
    reader.onloadend = () => {
      setFile(Buffer(reader.result));
    };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      // Conectar con IPFS
      const client = create({ url: "http://127.0.0.1:5001" });
      const result = await client.add(file);
      console.log("Archivo subido a IPFS:", result.cid.toString());
      setCid(result.cid.toString());

      // Añadirlo al FS del nodo IPFS
      await client.files.cp(`/ipfs/${result.cid}`, `/${result.cid}`);

      // Conectar con el contrato
      const signer = provider.getSigner();
      const crowdfunding = contract.connect(signer);

      console.log("Creando campaña...");
      const tx = await crowdfunding.createCampaign(
        title,
        result.cid.toString(),
        ethers.utils.parseEther(goal)
      );
      await tx.wait();

      alert("Campaña creada correctamente ✅");
    } catch (error) {
      console.error("Error:", error.message);
      alert("Error al crear campaña: " + error.message);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />
        <h2>Crowdfunding descentralizado con IPFS</h2>
        <p>Crea una campaña y almacena su descripción en IPFS</p>

        <form onSubmit={handleSubmit} className="form">
          <input
            type="text"
            placeholder="Título de la campaña"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <input
            type="number"
            placeholder="Objetivo (ETH)"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            required
          />
          <input type="file" onChange={handleFileChange} required />
          <button type="submit" className="btn">Crear campaña</button>
        </form>

        {cid && (
          <p style={{ marginTop: "20px" }}>
            📦 <b>IPFS Hash:</b> {cid}
            <br />
            🌐{" "}
            <a
              href={`http://127.0.0.1:8080/ipfs/${cid}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#00ffcc" }}
            >
              Ver archivo en IPFS
            </a>
          </p>
        )}
      </header>
    </div>
  );
}

export default App;
