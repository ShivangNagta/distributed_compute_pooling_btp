import { useState, useEffect } from 'react'
import ClientPage from './pages/ClientPage'

function HomePage() {
  const [message, setMessage] = useState("")

  // https://jasonwatmore.com/post/2020/02/01/react-fetch-http-post-request-examples
  useEffect(() => {

    // const requestOptions = {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ title: 'React Hooks POST Request Example' })
    // };

    const requestOptions = {
      method: 'GET',
    };
    fetch('http://localhost:3000/', requestOptions)
      .then(response => response.text())
      .then(data => setMessage(data));

  }, []);
  return (
    <>
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
