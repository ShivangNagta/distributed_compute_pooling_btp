import { useState, useEffect, useRef, useCallback } from 'react'
import ClientPage from './pages/ClientPage'

function HomePage() {
  const [message, setMessage] = useState("")
  const wsRef = useRef< WebSocket | null>(null);

  // https://jasonwatmore.com/post/2020/02/01/react-fetch-http-post-request-examples
  // useEffect(() => {

  //   // const requestOptions = {
  //   //   method: 'POST',
  //   //   headers: { 'Content-Type': 'application/json' },
  //   //   body: JSON.stringify({ title: 'React Hooks POST Request Example' })
  //   // };

  //   const requestOptions = {
  //     method: 'GET',
  //   };
  //   fetch('http://localhost:3000/', requestOptions)
  //     .then(response => response.text())
  //     .then(data => setMessage(data));

  // }, []);

  async function getHardwareInfo() {
    let gpuInfo = null;
    if (navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter && adapter.info) {
          gpuInfo = {
            vendor: adapter.info.vendor,
            architecture: adapter.info.architecture,
            device: adapter.info.device,
            description: adapter.info.description
          };
        }
      } catch (e) {
        console.warn("WebGPU not accessible", e);
      }
    }

    const payload = {
      cores: navigator.hardwareConcurrency || null,
      memoryGB: (navigator as any).deviceMemory || null,
      platform: navigator.platform || null,
      userAgent: navigator.userAgent || null,
      gpu: gpuInfo,
    };
    console.log("paylod", payload)
    return JSON.stringify(payload)

  }

  // https://websocket.org/guides/frameworks/react/
  useEffect(() => {
    const socket = new WebSocket(
      `ws://localhost:3000/ws/join_room/${encodeURIComponent("465b2f0d-68e4-4d82-b926-01655189f932")}/${encodeURIComponent("cwckZQ")}`
    );
    wsRef.current = socket;
    console.log("connected")

    socket.onmessage = (event) => {
      setMessage(event.data);
    };

    socket.onerror = (err) => {
      console.error("WebSocket error:", err);
    };

    return () => {
      socket.close(1000, "component unmounted");
    };
  }, []);

  const sendCapabilities = useCallback(async () => {
    let data = await getHardwareInfo()
    console.log(data)
    wsRef.current?.send(JSON.stringify(data));
  }, []);

  return (
    <>
      <div>
        <button onClick={() => sendCapabilities()}>
          Join Room
        </button>
      </div>
      <div className='text-2xl'>
        {message}
      </div>
    </>
  )
}

function App() {
  return window.location.pathname === '/client' ? <ClientPage /> : <HomePage />
}

export default App


