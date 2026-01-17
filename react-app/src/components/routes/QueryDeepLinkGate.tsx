import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

type Props = {
  paramKey: string;
  pathPrefix: string;
  fallback: React.ReactElement;
};

const QueryDeepLinkGate: React.FC<Props> = ({ paramKey, pathPrefix, fallback }) => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const targetId = params.get(paramKey);
    if (!targetId) return;
    params.delete(paramKey);
    const rest = params.toString();
    const encoded = encodeURIComponent(targetId);
    navigate(`${pathPrefix}/${encoded}${rest ? `?${rest}` : ''}`, { replace: true });
  }, [location.search, navigate, paramKey, pathPrefix]);

  return fallback;
};

export default QueryDeepLinkGate;
