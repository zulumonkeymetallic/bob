import React, { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../firebase';
import { User } from 'firebase/auth';

const UpcomingEvents = () => {
  const [events, setEvents] = useState<any[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(user => {
      if (user) {
        setUser(user);
        const calendarStatus = httpsCallable(functions, 'calendarStatus');
        calendarStatus().then(result => {
          setIsConnected((result.data as { connected: boolean }).connected);
          if ((result.data as { connected: boolean }).connected) {
            const listUpcomingEvents = httpsCallable(functions, 'listUpcomingEvents');
            listUpcomingEvents({ maxResults: 10 }).then(result => {
              setEvents((result.data as { items: any[] }).items);
            });
          }
        });
      } else {
        setUser(null);
        setEvents([]);
        setIsConnected(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleConnect = () => {
    if (user) {
      const nonce = Math.random().toString(36).slice(2);
      localStorage.setItem('oauth_nonce', nonce);
      window.location.href = `/api/oauth/start?uid=${user.uid}&nonce=${nonce}`;
    }
  };

  return (
    <div className="card">
      <div className="card-body">
        <h5 className="card-title">Upcoming Events</h5>
        {isConnected ? (
          <ul>
            {events.map((event: any) => (
              <li key={event.id}>
                {event.summary} - {new Date(event.start.dateTime).toLocaleString()}
              </li>
            ))}
          </ul>
        ) : (
          <div>
            <p>Connect your Google Calendar to see your upcoming events.</p>
            <button className="btn btn-primary" onClick={handleConnect}>
              Connect Google Calendar
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default UpcomingEvents;

export {};
