using System.Linq.Expressions;

namespace WebApplicationBase.Repositories.Db1.IRepository
{
    public interface IRepository<T> where T : class
    {
        T? GetFirstOrDefault(Expression<Func<T, bool>> filter);
        IEnumerable<T> GetAll();
        IEnumerable<T> GetAll(Expression<Func<T, bool>> filter);
        int GetMax(Func<T, int> column);
        void Add(T entity);
        void AddRange(IEnumerable<T> entity);
        void Update(T entity);
        void UpdateRange(IEnumerable<T> entity);
        void Remove(T entity);
        void RemoveRange(IEnumerable<T> entity);
    }
}
