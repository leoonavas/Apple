import Link from "next/link";

export default function TermsPage() {
  const contact = process.env.NEXT_PUBLIC_PRIVACY_EMAIL;
  return <main className="legal-page">
    <Link className="back-link" href="/login">Voltar</Link>
    <p className="eyebrow">USO DO SERVIÇO</p><h1>Termos do beta</h1>
    <p>O Arcadya Finanças ajuda a organizar dados financeiros informados por você. O beta não conecta a bancos, não movimenta dinheiro e não substitui orientação financeira, contábil, tributária ou jurídica.</p>
    <h2>Conta e informações</h2>
    <p>Use um e-mail que você controla e mantenha sua senha privada. Você é responsável por conferir os lançamentos sugeridos pela IA e por manter os dados enviados corretos. Quando a mensagem for ambígua, o app deve pedir esclarecimento antes de gravar.</p>
    <h2>Anexos e processamento</h2>
    <p>Envie somente arquivos que você tem autorização para usar. O beta aceita até quatro anexos por mensagem, 20 MB por arquivo, 30 MB armazenados por conta e 100 MB processados por mês. O OCR, a transcrição e a interpretação acontecem em um computador local conectado ao beta.</p>
    <h2>Disponibilidade e encerramento</h2>
    <p>Este é um beta para até 25 pessoas. A disponibilidade pode ser interrompida durante manutenção ou se o processador local estiver desconectado. Você pode exportar seus dados e excluir sua conta pela área “Conta e dados”.</p>
    <h2>Responsável e contato</h2>
    {contact ? <p>Contato: <a href={`mailto:${contact}`}>{contact}</a>. A identificação legal da pessoa que opera o serviço deve ser incluída antes do lançamento público.</p> : <p className="legal-incomplete">E-mail de contato e identificação legal da pessoa operadora precisam ser configurados antes do lançamento público.</p>}
    <p className="legal-updated">Última atualização: 30 de setembro de 2026.</p>
  </main>;
}
