import React, { useEffect, useState } from "react";
import "./App.css";
import { create } from "kubo-rpc-client";
import { ethers } from "ethers";
import { Buffer } from "buffer";
import logo from "./ethereumLogo.png";
import { addresses, abis } from "./contracts";
// Provider de Metamask (ethers v5)
const provider = new ethers.providers.Web3Provider(window.ethereum);

// Instancia del contrato AcademicCertificates
const contract = new ethers.Contract(
  addresses.certificates,
  abis.certificates,
  provider
);

// Deriva una clave simétrica AES-GCM a partir de una contraseña usando PBKDF2
async function deriveKeyFromPassword(password, salt) {
  const enc = new TextEncoder();
  const passKey = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    passKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// Cifra el PDF (Buffer) con AES-GCM y una contraseña
// Devuelve un Uint8Array: [salt (16 bytes) | iv (12 bytes) | ciphertext]
async function encryptPdf(buffer, password) {
  if (!password) {
    throw new Error("Se requiere una contraseña para cifrar el PDF.");
  }

  // Aseguramos que tenemos un Uint8Array
  const plainBytes =
    buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  window.crypto.getRandomValues(salt);
  window.crypto.getRandomValues(iv);

  const key = await deriveKeyFromPassword(password, salt);

  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    plainBytes
  );

  const cipherBytes = new Uint8Array(ciphertext);

  // Construimos [salt | iv | ciphertext]
  const result = new Uint8Array(salt.length + iv.length + cipherBytes.length);
  result.set(salt, 0);
  result.set(iv, salt.length);
  result.set(cipherBytes, salt.length + iv.length);

  return result;
}


function App() {
  const [file, setFile] = useState(null);          // PDF en Buffer
  const [student, setStudent] = useState("");      // Dirección del alumno
  const [courseName, setCourseName] = useState("");
  const [grade, setGrade] = useState("");          // Nota opcional
  const [cid, setCid] = useState("");              // CID de IPFS
  const [docHash, setDocHash] = useState("");      // Hash del documento
  const [status, setStatus] = useState("");        // Mensajes de estado
  const [account, setAccount] = useState("");      // Cuenta conectada
  const [isIssuer, setIsIssuer] = useState(false); // Si es emisor autorizado
  const [verifyFile, setVerifyFile] = useState(null);   // PDF para verificar
  const [verifyHash, setVerifyHash] = useState("");     // Hash introducido
  const [verifyStatus, setVerifyStatus] = useState(""); // Mensajes de verificación
  const [verifyData, setVerifyData] = useState(null);   // Datos del certificado verificado
  const [listAddress, setListAddress] = useState("");      // Dirección a consultar
  const [listStatus, setListStatus] = useState("");        // Mensajes de listado
  const [listResults, setListResults] = useState([]);      // Certificados encontrados
  const [encPassword, setEncPassword] = useState(""); // contraseña para cifrar el PDF
  const [isOwner, setIsOwner] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [ownerAddress, setOwnerAddress] = useState("");


  useEffect(() => {
    async function init() {
      if (!window.ethereum) {
        setStatus("Necesitas tener MetaMask instalada.");
        return;
      }

      try {
        // No pedimos conexión, solo miramos si ya hay cuentas conectadas
        const accounts = await provider.listAccounts();
        if (accounts.length === 0) {
          // Todavía no hay wallet conectada: esperamos a que el usuario pulse el botón
          return;
        }

        const acc = accounts[0];
        setAccount(acc);

        // 1) Owner del contrato
        try {
          const owner = await contract.owner();
          setOwnerAddress(owner);
          setIsOwner(acc.toLowerCase() === owner.toLowerCase());
        } catch (err) {
          console.error("Error obteniendo owner del contrato:", err);
          setIsOwner(false);
        }

        // 2) Estado de pausa del contrato
        try {
          const pausedValue = await contract.paused();
          setIsPaused(pausedValue);
        } catch (err) {
          console.error("Error comprobando paused:", err);
        }

        // 3) Comprobar si es emisor autorizado en el contrato
        try {
          const authorized = await contract.authorizedIssuers(acc);
          setIsIssuer(authorized);
        } catch (err) {
          console.error("Error comprobando authorizedIssuers:", err);
          setIsIssuer(false);
        }
      } catch (err) {
        console.error("Error inicializando conexión con MetaMask:", err);
        setStatus("Error conectando con MetaMask.");
      }
    }

    init();
  }, []);

  // Leer el archivo y guardarlo como Buffer (igual que en la práctica 2)
  const handleFileChange = (e) => {
    const data = e.target.files[0];
    if (!data) return;

    const reader = new window.FileReader();
    reader.readAsArrayBuffer(data);
    reader.onloadend = () => {
      const buffer = Buffer(reader.result);
      setFile(buffer);
    };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      if (!file) {
        alert("Selecciona primero un PDF del certificado.");
        return;
      }
      if (!student || !courseName) {
        alert("Rellena la dirección del estudiante y el nombre del curso.");
        return;
      }

      if (!ethers.utils.isAddress(student)) {
        alert("La dirección del estudiante no es una dirección Ethereum válida.");
        return;
      }

      if (!encPassword) {
        alert("Introduce una contraseña para cifrar el PDF.");
        return;
      }

      setStatus("Conectando con el nodo IPFS...");
      const client = create({ url: "http://127.0.0.1:5001" });

      // 1) Calcular el hash del PDF en claro (para el contrato)
      const hash = ethers.utils.keccak256(file);
      setDocHash(hash);

      // 2) Cifrar el PDF en el navegador con la contraseña
      setStatus("Cifrando PDF en el navegador...");
      const encryptedBytes = await encryptPdf(file, encPassword);

      // 3) Subir a IPFS el PDF CIFRADO (no el original)
      setStatus("Subiendo archivo cifrado a IPFS...");
      const result = await client.add(encryptedBytes);
      const newCid = result.cid.toString();
      setCid(newCid);

      try {
        await client.files.cp(`/ipfs/${result.cid}`, `/${result.cid}`);
      } catch (err) {
        console.warn("No se pudo hacer files.cp (no es grave):", err.message);
      }


      // 4) Conectar con el contrato como emisor y llamar a issueCertificate
      setStatus("Firmando transacción en MetaMask...");

      const signer = provider.getSigner();
      const certificates = contract.connect(signer);

      const tx = await certificates.issueCertificate(
        hash,
        newCid,
        student,
        courseName,
        grade
      );



      setStatus("Esperando confirmación de la transacción...");

      await tx.wait();

      setStatus("✅ Certificado emitido correctamente en la blockchain.");
      alert("Certificado emitido correctamente ✅");
    } catch (error) {
      console.error("Error:", error);
      setStatus("❌ Error al emitir el certificado: " + (error.message || error));
      alert("Error al emitir certificado: " + (error.message || error));
    }
  };
  const connectWallet = async () => {
    if (!window.ethereum) {
      setStatus("Necesitas tener MetaMask instalada.");
      return;
    }

    try {
      setStatus("Conectando con MetaMask...");

      // Aquí sí pedimos permiso al usuario
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });

      if (!accounts || accounts.length === 0) {
        setStatus("No se ha seleccionado ninguna cuenta.");
        return;
      }

      const acc = accounts[0];
      setAccount(acc);

      // 1) Owner del contrato
      try {
        const owner = await contract.owner();
        setOwnerAddress(owner);
        setIsOwner(acc.toLowerCase() === owner.toLowerCase());
      } catch (err) {
        console.error("Error obteniendo owner del contrato:", err);
        setIsOwner(false);
      }

      // 2) Estado de pausa del contrato
      try {
        const pausedValue = await contract.paused();
        setIsPaused(pausedValue);
      } catch (err) {
        console.error("Error comprobando paused:", err);
      }

      // 3) Comprobar si es emisor autorizado
      try {
        const authorized = await contract.authorizedIssuers(acc);
        setIsIssuer(authorized);
      } catch (err) {
        console.error("Error comprobando authorizedIssuers:", err);
        setIsIssuer(false);
      }

      setStatus(""); // limpiar mensajes si todo ha ido bien
    } catch (err) {
      console.error("Error al conectar wallet:", err);
      // Si el usuario cierra el popup o rechaza, suele venir un error con code 4001
      if (err.code === 4001) {
        setStatus("Conexión con MetaMask cancelada por el usuario.");
      } else {
        setStatus("Error al conectar con MetaMask: " + (err.message || err));
      }
    }
  };

  const handleListCertificates = async (e) => {
    e.preventDefault();

    try {
      setListStatus("");
      setListResults([]);

      if (!account) {
        alert("Conecta tu wallet para ver tus certificados.");
        return;
      }

      const addressToQuery = account; // solo tu propia dirección

      setListStatus("Buscando tus certificados en la blockchain...");

      // 1) Conectar el contrato con el signer (tu cuenta de alumno)
      const signer = provider.getSigner();
      const certContract = contract.connect(signer);

      // 2) Obtener lista de hashes del estudiante (tú mismo)
      const hashes = await certContract.getCertificatesByStudent(addressToQuery);

      if (!hashes || hashes.length === 0) {
        setListStatus("ℹ️ No tienes certificados registrados.");
        return;
      }

      // 3) Para cada hash, obtener los datos del certificado
      const promises = hashes.map(async (h) => {
        const [
          ipfsCid,
          issuer,
          studentAddr,
          courseName,
          issueDate,
          grade,
          revoked
        ] = await certContract.getCertificate(h);

        const issueDateNumber = issueDate.toNumber
          ? issueDate.toNumber()
          : Number(issueDate);

        return {
          hash: h,
          ipfsCid,
          issuer,
          student: studentAddr,
          courseName,
          issueDate: new Date(issueDateNumber * 1000).toLocaleString(),
          grade,
          revoked
        };
      });

      const certificates = await Promise.all(promises);

      setListResults(certificates);
      setListStatus(`✅ Encontrados ${certificates.length} certificado(s).`);
    } catch (error) {
      console.error("Error listando certificados:", error);
      setListStatus(
        "❌ Error al listar certificados: " + (error.message || error)
      );
    }
  };

  const handleRevoke = async () => {
    if (!verifyData || !verifyData.hash) {
      alert("No hay ningún certificado cargado para revocar.");
      return;
    }

    if (!account || !isOwnerOrIssuer) {
      alert("Solo el emisor del certificado o el owner del contrato pueden revocarlo.");
      return;
    }

    if (isPaused) {
      alert("El contrato está pausado. No se pueden revocar certificados ahora mismo.");
      return;
    }

    const confirmRevoke = window.confirm(
      "¿Seguro que quieres revocar este certificado? " +
      "La verificación indicará que ya no es válido."
    );
    if (!confirmRevoke) return;

    try {
      setVerifyStatus("Firmando transacción de revocación en MetaMask...");

      const signer = provider.getSigner();
      const certContract = contract.connect(signer);

      const tx = await certContract.revokeCertificate(verifyData.hash);
      await tx.wait();

      // Actualizamos el estado local para reflejar la revocación
      setVerifyData({
        ...verifyData,
        revokedOrInvalid: true,
      });

      setVerifyStatus("🔴 Certificado revocado correctamente.");
    } catch (error) {
      console.error("Error revocando certificado:", error);
      setVerifyStatus(
        "❌ Error al revocar el certificado: " + (error.message || error)
      );
    }
  };


  const handleTogglePause = async () => {
    if (!account || !isOwner) {
      alert("Solo el owner del contrato puede cambiar el estado de pausa.");
      return;
    }

    try {
      setStatus("Firmando transacción de pausa en MetaMask...");

      const signer = provider.getSigner();
      const contractWithSigner = contract.connect(signer);

      const newPaused = !isPaused;
      const tx = await contractWithSigner.setPaused(newPaused);
      await tx.wait();

      setIsPaused(newPaused);
      setStatus(newPaused
        ? "⏸️ Contrato pausado correctamente."
        : "▶️ Contrato reanudado correctamente."
      );
    } catch (err) {
      console.error("Error al cambiar pausa:", err);
      setStatus("❌ Error al cambiar el estado de pausa: " + (err.message || err));
    }
  };


  const handleVerify = async (e) => {
    e.preventDefault();

    try {
      setVerifyStatus("");
      setVerifyData(null);

      let hashToCheck = verifyHash;

      // Si no hay hash escrito pero sí PDF, calculamos el hash del PDF
      if (!hashToCheck) {
        if (!verifyFile) {
          alert("Introduce un hash o sube un PDF para verificar.");
          return;
        }
        const hash = ethers.utils.keccak256(verifyFile);
        hashToCheck = hash;
        setVerifyHash(hash);
      }

      setVerifyStatus("Comprobando certificado en la blockchain...");

      // NUEVO: llamada a verifyCertificate del contrato
      const [
        exists,
        valid,
        issuer,
        studentAddr,
        courseName,
        grade,
        issueDate,
        issuerAuthorized,
      ] = await contract.verifyCertificate(hashToCheck);

      if (!exists) {
        setVerifyStatus("❌ No hay ningún certificado registrado con ese hash.");
        return;
      }

      const issueDateNumber = issueDate.toNumber
        ? issueDate.toNumber()
        : Number(issueDate);
      const issueDateStr = new Date(issueDateNumber * 1000).toLocaleString();

      setVerifyData({
        hash: hashToCheck,
        issuer,
        student: studentAddr,
        courseName,
        grade,
        issueDate: issueDateStr,
        revokedOrInvalid: !valid,
        issuerAuthorized,
      });

      setVerifyStatus(valid ? "✅ Certificado válido." : "⚠️ Certificado NO válido (revocado o emisor no autorizado).");
    } catch (error) {
      console.error("Error verificando certificado:", error);
      setVerifyStatus(
        "❌ Error al verificar el certificado: " + (error.message || error)
      );
    }
  };


  const handleVerifyFileChange = (e) => {
    const data = e.target.files[0];
    if (!data) return;

    const reader = new window.FileReader();
    reader.readAsArrayBuffer(data);
    reader.onloadend = () => {
      const buffer = Buffer(reader.result);
      setVerifyFile(buffer);
    };
  };

   useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = async (accounts) => {
      if (!accounts || accounts.length === 0) {
        setAccount("");
        setIsIssuer(false);
        setIsOwner(false);
        setOwnerAddress("");
        return;
      }

      const acc = accounts[0];
      setAccount(acc);

      try {
        // 1) Owner del contrato
        try {
          const owner = await contract.owner();
          setOwnerAddress(owner);
          setIsOwner(acc.toLowerCase() === owner.toLowerCase());
        } catch (err) {
          console.error("Error obteniendo owner del contrato:", err);
          setIsOwner(false);
        }

        // 2) Estado de pausa del contrato
        try {
          const pausedValue = await contract.paused();
          setIsPaused(pausedValue);
        } catch (err) {
          console.error("Error comprobando paused:", err);
        }

        // 3) Emisor autorizado
        try {
          const authorized = await contract.authorizedIssuers(acc);
          setIsIssuer(authorized);
        } catch (err) {
          console.error("Error comprobando authorizedIssuers:", err);
          setIsIssuer(false);
        }
      } catch (err) {
        console.error("Error gestionando cambio de cuenta:", err);
        setIsIssuer(false);
        setIsOwner(false);
      }
    };

    window.ethereum.on("accountsChanged", handleAccountsChanged);

    // cleanup del useEffect
    return () => {
      window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
    };
  }, []);

  const isOwnerOrIssuer =
    account &&
    verifyData &&
    (
      account.toLowerCase() === verifyData.issuer.toLowerCase() ||
      account.toLowerCase() === ownerAddress.toLowerCase()
    );

  

    return (
    <div className="app">
      {/* HEADER PRINCIPAL */}
      <header className="app-header">
        <div className="logo-title">
          <img src={logo} className="app-logo" alt="Ethereum logo" />
          <div>
            <h1 className="app-title">
              dApp de certificados académicos
              <span className="app-subtitle"> (Ethereum + IPFS)</span>
            </h1>
            <p className="app-description">
              Registro y verificación de certificados académicos en{" "}
              <span className="highlight">Ethereum</span>, almacenando el PDF
              en <span className="highlight">IPFS</span> y guardando solo su{" "}
              <span className="highlight">hash</span> en la blockchain.
            </p>
          </div>
        </div>
      </header>

      {/* ESTADO DE CUENTA / EMISOR */}
      <section className="status-card">
        <div className="status-header">
          <div>
            <span className="status-label">Cuenta conectada</span>
            <div className="status-value mono">
              {account || "No conectada"}
            </div>
          </div>

          {!account && (
            <div className="status-actions">
              <p className="status-warning">
                Wallet no conectada. Pulsa el botón para conectar MetaMask.
              </p>
              <button className="btn-primary" onClick={connectWallet}>
                Conectar wallet
              </button>
            </div>
          )}
        </div>

        {account && (
          <div className="status-badges">
            <span className="badge badge-ok">Wallet conectada</span>
            <span className={`badge ${isIssuer ? "badge-ok" : "badge-error"}`}>
              {isIssuer ? "Emisor autorizado ✅" : "NO es emisor autorizado"}
            </span>
            <span className={`badge ${isPaused ? "badge-error" : "badge-ok"}`}>
              {isPaused ? "Contrato PAUSADO" : "Contrato activo"}
            </span>
            {isOwner && (
              <button
                className="btn-secondary"
                style={{ marginLeft: "8px" }}
                onClick={handleTogglePause}
              >
                {isPaused ? "Reanudar contrato" : "Pausar contrato"}
              </button>
            )}
          </div>
        )}
      </section>

      {/* CONTENIDO PRINCIPAL */}
      <main className="main-layout">
        {/* IZQUIERDA: EXPLICACIÓN DEL PROYECTO */}
        <section className="info-card">
          <h2>¿Qué problema resuelve?</h2>
          <p className="info-text">
            Los certificados académicos (asistencia, TFG, prácticas…) suelen
            enviarse como PDFs fáciles de falsificar. Verificarlos implica
            contactar con la universidad o el centro y el proceso no está
            automatizado.
          </p>

          <h3>Solución propuesta</h3>
          <ol className="steps">
            <li>
              Un <strong>emisor autorizado</strong> (universidad, profesor,
              academia) sube el PDF del certificado.
            </li>
            <li>
              El PDF se almacena en <strong>IPFS</strong> y en el navegador se
              calcula su <strong>hash (keccak256)</strong>.
            </li>
            <li>
              El smart contract{" "}
              <span className="mono">AcademicCertificates</span> guarda:
              <br />
              <span className="mono">
                docHash, ipfsCid, emisor, alumno, curso, fecha, nota, revocado
              </span>
              .
            </li>
            <li>
              Más tarde, una empresa o institución podrá{" "}
              <strong>verificar</strong> el certificado comprobando si el hash
              está registrado y quién lo emitió.
            </li>
          </ol>
        </section>

        {/* DERECHA: EMITIR + RESULTADOS */}
        <section className="forms-column">
          {/* FORMULARIO: EMITIR CERTIFICADO */}
          <section className="card">
            <div className="card-header">
              <h2>Emitir certificado</h2>
              <p>
                Registra un nuevo certificado académico en la blockchain para un
                estudiante concreto.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="form">
              <div className="form-group">
                <label>Dirección del estudiante</label>
                <input
                  type="text"
                  className="input"
                  placeholder="0x... dirección de la wallet del alumno"
                  value={student}
                  onChange={(e) => setStudent(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Nombre del certificado</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Ejemplo: TFG - dApp de certificados académicos"
                  value={courseName}
                  onChange={(e) => setCourseName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Nota (opcional)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Ejemplo: 9.0 / Sobresaliente"
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Contraseña para cifrar el PDF</label>
                <input
                  type="password"
                  className="input"
                  placeholder="Contraseña que el alumno usará para descifrar"
                  value={encPassword}
                  onChange={(e) => setEncPassword(e.target.value)}
                  required
                />
                <p className="hint">
                  El PDF se cifrará en el navegador con esta contraseña antes de
                  subirlo a IPFS. La contraseña no se guarda en la blockchain.
                </p>
              </div>

              <div className="form-group">
                <label>PDF del certificado</label>
                <input
                  type="file"
                  className="input-file"
                  accept="application/pdf"
                  onChange={handleFileChange}
                  required
                />
                <p className="hint">
                  El PDF se subirá a IPFS y solo se guardarán el{" "}
                  <strong>hash</strong> y el <strong>CID</strong> en la
                  blockchain.
                </p>
              </div>

              <div className="form-actions">
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={!account || !isIssuer || !file}
                >
                  Emitir certificado
                </button>
                {!isIssuer && account && (
                  <span className="error-text">
                    Esta cuenta no es emisor autorizado. Debe añadirse con
                    <span className="mono"> addIssuer()</span> desde el owner.
                  </span>
                )}
              </div>
            </form>

            {status && <p className="status-text">{status}</p>}
          </section>

          {/* RESULTADOS: CID, HASH, ENLACE IPFS */}
          {(cid || docHash) && (
            <section className="card">
              <div className="card-header">
                <h2>Detalles del certificado emitido</h2>
              </div>

              {cid && (
                <div className="result-block">
                  <p className="result-label">IPFS CID</p>
                  <p className="result-mono mono">{cid}</p>
                  <p className="result-link"></p>
                </div>
              )}

              {docHash && (
                <div className="result-block">
                  <p className="result-label">
                    Hash del documento (keccak256 del PDF)
                  </p>
                  <p className="result-mono mono small">{docHash}</p>
                </div>
              )}
            </section>
          )}

          {/* VERIFICAR CERTIFICADO */}
          <section className="card">
            <div className="card-header">
              <h2>Verificar certificado</h2>
              <p>
                Introduce el <strong>hash</strong> del certificado o sube el{" "}
                <strong>PDF</strong>. La dApp comprobará si el hash está
                registrado en el contrato{" "}
                <span className="mono">AcademicCertificates</span>.
              </p>
            </div>

            <form onSubmit={handleVerify} className="form">
              <div className="form-group">
                <label>Hash del certificado (opcional si subes PDF)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="0x... hash keccak256 del PDF"
                  value={verifyHash}
                  onChange={(e) => setVerifyHash(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>PDF del certificado (opcional si escribes el hash)</label>
                <input
                  type="file"
                  className="input-file"
                  accept="application/pdf"
                  onChange={handleVerifyFileChange}
                />
                <p className="hint">
                  Si no introduces un hash, se calculará automáticamente a
                  partir del PDF.
                </p>
              </div>

              <div className="form-actions">
                <button type="submit" className="btn-primary">
                  Verificar certificado
                </button>
              </div>
            </form>

            {verifyStatus && (
              <p className="status-text" style={{ marginTop: "8px" }}>
                {verifyStatus}
              </p>
            )}

            {verifyData && (
              <div className="result-block" style={{ marginTop: "10px" }}>
                <p className="result-label">Resultado de la verificación</p>

                <p className="result-mono mono small">
                  <strong>Hash:</strong> {verifyData.hash}
                </p>

                <p className="result-mono mono small">
                  <strong>Emisor (wallet):</strong> {verifyData.issuer}
                </p>

                <p className="result-mono mono small">
                  <strong>Estudiante (wallet):</strong> {verifyData.student}
                </p>

                <p className="result-mono mono small">
                  <strong>Curso:</strong> {verifyData.courseName}
                </p>

                <p className="result-mono mono small">
                  <strong>Fecha emisión:</strong> {verifyData.issueDate}
                </p>

                <p className="result-mono mono small">
                  <strong>Estado:</strong>{" "}
                  {verifyData.revokedOrInvalid
                    ? "🔴 NO válido (revocado o emisor no autorizado)"
                    : "🟢 Válido"}
                </p>

                {isOwnerOrIssuer && !verifyData.revokedOrInvalid && (
                  <div style={{ marginTop: "8px" }}>
                    <button
                      className="btn-danger"
                      type="button"
                      onClick={handleRevoke}
                      disabled={isPaused}
                    >
                      Revocar certificado
                    </button>
                    {isPaused && (
                      <p className="hint">
                        El contrato está pausado, no se puede revocar hasta que
                        se reanude.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* LISTAR CERTIFICADOS DE UN ESTUDIANTE */}
          {account && !isIssuer && (
            <section className="card">
              <div className="card-header">
                <h2>Mis certificados</h2>
                <p>
                  Consulta todos los certificados emitidos para tu wallet
                  conectada.
                </p>
              </div>

              <form onSubmit={handleListCertificates} className="form">
                <p className="hint">
                  Wallet actual:{" "}
                  <span className="mono">
                    {account || "Conecta tu wallet para ver tus certificados"}
                  </span>
                </p>

                <div className="form-actions">
                  <button type="submit" className="btn-primary" disabled={!account}>
                    Ver mis certificados
                  </button>
                </div>
              </form>

              {listStatus && (
                <p className="status-text" style={{ marginTop: "8px" }}>
                  {listStatus}
                </p>
              )}

              {listResults && listResults.length > 0 && (
                <div className="result-block" style={{ marginTop: "10px" }}>
                  <p className="result-label">Certificados encontrados</p>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    {listResults.map((cert, idx) => (
                      <div
                        key={idx}
                        className="result-mono mono small"
                        style={{ textAlign: "left" }}
                      >
                        <div>
                          <strong>Curso:</strong> {cert.courseName}
                        </div>
                        <div>
                          <strong>Fecha:</strong> {cert.issueDate}
                        </div>
                        <div>
                          <strong>Emisor:</strong> {cert.issuer}
                        </div>
                        <div>
                          <strong>Estado:</strong>{" "}
                          {cert.revoked ? "🔴 Revocado" : "🟢 Válido"}
                        </div>
                        <div>
                          <strong>Hash:</strong> {cert.hash}
                        </div>
                        {cert.ipfsCid && (
                          <div style={{ marginTop: "4px" }}>{/* link IPFS */}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </section>
      </main>
    </div>
  );

}


export default App;
