using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using System.Data;
using WebApplicationBase.Data;
using WebApplicationBase.Repositories.Db2.IRepository;

namespace WebApplicationBase.Repositories.Db2
{
    public class UnitOfWork : IUnitOfWork, IDisposable
    {
        private AppDb2Context _db;
        private readonly IHttpContextAccessor _httpCtAsor;

        public UnitOfWork(AppDb2Context db, IHttpContextAccessor httpCtAsor)
        {
            _db = db;
            _httpCtAsor = httpCtAsor;
            MstEtc = new MstEtcRepository(_db, _httpCtAsor);
        }

        public IMstEtcRepository MstEtc { get; private set; }

        public void UpdateEntry<T>(T entity)
        {
            if (entity != null)
            {
                _db.Entry(entity).State = EntityState.Modified;
            }
        }
        public void Save()
        {
            _db.SaveChanges();
        }

        public IDbContextTransaction BeginTransaction(IsolationLevel isolationLevel = IsolationLevel.ReadCommitted)
        {
            return _db.Database.BeginTransaction(isolationLevel);
        }

        public void Dispose()
        {
            if (_db != null)
            {
                _db.Dispose();
            }
        }
    }
}
